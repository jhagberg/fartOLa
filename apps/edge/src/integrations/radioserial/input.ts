// Authored for fartola. Not ported from upstream.
//
// Serial radio input: listens on a serial port for the autosend records of
// SI stations (a jSh.Radio gateway on USB, an SRR receiver, an online
// station) and stores each punch as a radio_punch on the active competition,
// next to the ROC punches. The radio status, the speaker and kvar i skogen
// read both the same way.
//
// - Listen only. Nothing is ever written to the port: a jSh gateway is no SI
//   station and answers no commands (so SiMainStation, which sends when it
//   connects, cannot be used on it).
// - Only the time of day is used, placed on the competition clock like a ROC
//   time (roc/place.ts). The record carries no date.
// - A punch heard twice (two routers, a resend) is stored once: the key is
//   control, card and time of day to 1/256 s. Two punches in the same second
//   are two punches.
// - A gateway is silent between punches and sends no heartbeat we know of,
//   so an open port only says the cable is in. Whether the radio network
//   delivers is the watchdog's question (roc/watchdog.ts).
// - Like ROC punches these never touch the projection: no markDirty.
// - The port is reopened for as long as the program runs (cable pulled,
//   gateway restarted).

import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { AutosendListener, SerialTransport } from '@fartola/sportident';
import type { AutosendPunch, ISerialTransport } from '@fartola/sportident';
import type { RadioSerialStatus } from '@fartola/shared-types';

import { competitions } from '../../db/schema.ts';
import type { DbHandle } from '../../db/index.ts';
import { insertEvent } from '../../si/eventInserter.ts';
import { competitionClockOffsetMin } from '../../time/competitionClock.ts';
import { placeRadioPunch } from '../roc/place.ts';

const HALF_DAY_S = 12 * 3600;
/** As the SI bridge: ramp up, then retry at the last step for ever. */
const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 5000];

export interface RadioSerialInputOpts {
  handle: DbHandle;
  nodeId: string;
  log?: FastifyBaseLogger;
  /** Serial device, e.g. /dev/ttyUSB1. */
  path: string;
  getActiveCompetitionId: () => string | null;
  /** Called once per stored punch (not for duplicates). */
  onInserted?: (competitionId: string) => void;
  now?: () => number;
  /** Test seam; the default opens `path` at 38400 baud. */
  openTransport?: (path: string) => ISerialTransport;
  backoffMs?: readonly number[];
}

export interface RadioSerialInputHandle {
  /** Resolves after the first open attempt, whether it worked or not. */
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): RadioSerialStatus;
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The record's 12 h clock and half-day bit → 'HH:MM:SS'. */
export function autosendTimeOfDay(clock: AutosendPunch['clock']): string {
  const s = clock.half_day * HALF_DAY_S + clock.seconds_in_half_day;
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

export function createRadioSerialInput(opts: RadioSerialInputOpts): RadioSerialInputHandle {
  const { handle, nodeId, path, log } = opts;
  const now = opts.now ?? Date.now;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const openTransport =
    opts.openTransport ?? ((p: string) => new SerialTransport({ path: p, baudRate: 38400 }));

  let transport: ISerialTransport | null = null;
  let listener: AutosendListener | null = null;
  let connected = false;
  let stopped = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;
  let lastError: string | null = null;
  let lastPunchAt: number | null = null;
  // Counters live here, not on the listener: a reconnect makes a new listener.
  const counts = {
    punches: 0,
    duplicates: 0,
    no_competition: 0,
    ignored: 0,
    frame_errors: 0,
    legacy_records: 0,
  };

  const store = (punch: AutosendPunch): void => {
    const receivedAtMs = now();
    lastPunchAt = receivedAtMs;
    const competitionId = opts.getActiveCompetitionId();
    const comp =
      competitionId === null
        ? undefined
        : handle.db
            .select({ date: competitions.date, clockOffsetMin: competitions.clockOffsetMin })
            .from(competitions)
            .where(eq(competitions.id, competitionId))
            .get();
    if (competitionId === null || !comp) {
      counts.no_competition++;
      return;
    }
    const time = autosendTimeOfDay(punch.clock);
    const subsec = punch.clock.subsec_256 ?? 0;
    const payload = {
      event_type: 'radio_punch',
      source: 'serial',
      idempotency_key: `serial:${punch.code}:${punch.card_number}:${time}:${subsec}`,
      card_number: punch.card_number,
      control_code: punch.code,
      time_of_day: time,
      received_at_ms: receivedAtMs,
      date_mismatch: false,
      subsec_256: subsec,
      weekday: punch.clock.weekday,
      station_mem_address: punch.mem_address,
      port: path,
    } as const;
    try {
      insertEvent(
        handle,
        nodeId,
        'radio_punch',
        placeRadioPunch(payload, competitionClockOffsetMin(comp.date, comp.clockOffsetMin)),
        payload,
        competitionId
      );
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      counts.duplicates++;
      return;
    }
    counts.punches++;
    opts.onInserted?.(competitionId);
  };

  /** Adds what the current listener counted and lets go of it. */
  const teardown = async (): Promise<void> => {
    const t = transport;
    const l = listener;
    transport = null;
    listener = null;
    connected = false;
    if (l) {
      l.stop();
      counts.ignored += l.counts.ignored;
      counts.frame_errors += l.counts.frame_errors;
      counts.legacy_records += l.counts.legacy_records;
    }
    if (t) {
      try {
        await t.close();
      } catch {
        /* best-effort */
      }
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || timer !== null) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)]!;
    attempt++;
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay);
  };

  const open = async (): Promise<void> => {
    if (stopped) return;
    await teardown();
    // stop() may have run while the old port was closing.
    if (stopped) return;
    const t = openTransport(path);
    transport = t;
    const lost = (why: string): void => {
      // A transport we have let go of (teardown closes it) says nothing.
      if (stopped || transport !== t) return;
      // One line when the port goes away or is not there at the start; the
      // retries while it stays away are silent.
      if (connected || attempt === 0) log?.warn({ path, err: why }, 'radio serial port not open');
      connected = false;
      lastError = why;
      scheduleReconnect();
    };
    // Before open(): an 'error' with no listener would crash the process.
    t.on('error', (err) => lost(err.message));
    try {
      await t.open();
    } catch (e) {
      lost(e instanceof Error ? e.message : String(e));
      return;
    }
    // stop() or a newer attempt took over while the port was opening: it
    // could not close a port that was not open yet.
    if (transport !== t) {
      await t.close().catch(() => undefined);
      return;
    }
    t.on('close', () => lost('port closed'));
    const l = new AutosendListener(t);
    l.on('punch', (p) => {
      try {
        store(p);
      } catch (e) {
        log?.error({ path, err: e instanceof Error ? e.message : String(e) }, 'radio punch');
      }
    });
    listener = l;
    connected = true;
    lastError = null;
    attempt = 0;
    log?.info({ path }, 'radio serial port open');
  };

  return {
    start: () => open(),
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await teardown();
    },
    status() {
      const live = listener?.counts;
      return {
        path,
        connected,
        last_error: lastError,
        last_punch_at: lastPunchAt,
        punches: counts.punches,
        duplicates: counts.duplicates,
        no_competition: counts.no_competition,
        ignored: counts.ignored + (live?.ignored ?? 0),
        frame_errors: counts.frame_errors + (live?.frame_errors ?? 0),
        legacy_records: counts.legacy_records + (live?.legacy_records ?? 0),
      };
    },
  };
}
