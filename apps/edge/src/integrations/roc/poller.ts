// Authored for fartola. Not ported from upstream.
//
// ROC poller: GET getpunches.asp?unitId=<roc id>&lastId=<n>, one request per
// competition per poll. NEVER sends date/time: the server filters on
// timestamp, and a sender with a wrong clock stamps rows with another date
// (2026-10-04, 18h50m behind) which the filter then hides.
//
// - Rows from before the competition are skipped by id, never by timestamp.
//   The baseline never looks at the row date: the first poll after ROC is
//   switched on (no stored start id) takes everything that exists then as
//   history (start id = highest id + 1) and stores it in
//   competitions.roc_start_id; every row after that counts, whatever its
//   date. An explicit start id set by the operator wins.
// - Only the time of day is used (place.ts); a row whose date is not the
//   competition date is stored with date_mismatch=true, never dropped.
// - Every ROC row is stored once (idempotency key = unit:row id), also when it
//   repeats a punch another sender already delivered: the same punch via two
//   sender types is collapsed when read (watchdog), not here, so a wrong-dated
//   duplicate still raises its date warning.
// - A response is applied only if the competition's ROC settings are the ones
//   the request was made with; otherwise it is discarded.
// - Radio punches are events but never touch the projection: no markDirty
//   here (that would also trigger a liveresultat push every few seconds).
// - lastId is stored on the competition row so a restart resumes.

import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';

import { competitions } from '../../db/schema.ts';
import type { DbHandle } from '../../db/index.ts';
import { insertEvent } from '../../si/eventInserter.ts';
import { parseRocResponse, type RocRow } from './parse.ts';
import { placeTimeOfDay } from './place.ts';

export const ROC_DEFAULT_URL = 'http://roc.olresultat.se/getpunches.asp';
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const TICK_MS = 1_000;

export interface RocBatch {
  /** Rows ROC returned. */
  received: number;
  inserted: number;
  duplicates: number;
  /** Stored rows whose date is not the competition date. */
  dateMismatches: number;
  /** Rows below the start id (history), not stored. */
  skipped: number;
  malformed: number;
}

export interface RocPollStatus {
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastBatch: RocBatch | null;
}

export interface RocPollerHandle {
  /** One poll for a competition now. Resolves null when ROC is off for it;
   * throws on HTTP/network errors (the timer loop catches and backs off). */
  pollOnce(competitionId: string): Promise<RocBatch | null>;
  start(): void;
  stop(): void;
  status(competitionId: string): RocPollStatus;
}

export interface RocPollerOpts {
  handle: DbHandle;
  nodeId: string;
  log?: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
  url?: string;
  now?: () => number;
  intervalMs?: number;
  maxBackoffMs?: number;
  timeoutMs?: number;
}

interface Runtime extends RocPollStatus {
  nextAt: number;
  inFlight: boolean;
}

/** Delay before the next poll: the interval after a success, doubling per
 * consecutive failure up to the cap. */
export function nextDelayMs(failures: number, intervalMs: number, maxBackoffMs: number): number {
  return failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, maxBackoffMs);
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export function createRocPoller(opts: RocPollerOpts): RocPollerHandle {
  const { handle, nodeId } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.url ?? ROC_DEFAULT_URL;
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runtimes = new Map<string, Runtime>();
  let timer: NodeJS.Timeout | null = null;

  const runtime = (id: string): Runtime => {
    let r = runtimes.get(id);
    if (!r) {
      r = {
        lastPollAt: null,
        lastSuccessAt: null,
        lastError: null,
        consecutiveFailures: 0,
        lastBatch: null,
        nextAt: 0,
        inFlight: false,
      };
      runtimes.set(id, r);
    }
    return r;
  };

  async function fetchRows(unitId: string, lastId: number): Promise<string> {
    // Exactly unitId + lastId. ROC answers 500 without lastId.
    const query = new URLSearchParams({ unitId, lastId: String(lastId) });
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${url}?${query.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`ROC HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  type Cursor = {
    date: string;
    enabled: boolean;
    unitId: string | null;
    startId: number | null;
    lastId: number | null;
  };

  function readCursor(competitionId: string): Cursor | undefined {
    return handle.db
      .select({
        date: competitions.date,
        enabled: competitions.rocEnabled,
        unitId: competitions.rocCompetitionId,
        startId: competitions.rocStartId,
        lastId: competitions.rocLastId,
      })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
  }

  async function pollOnce(competitionId: string): Promise<RocBatch | null> {
    const comp = readCursor(competitionId);
    if (!comp || !comp.enabled || !comp.unitId) return null;
    const unitId = comp.unitId;

    // lastId to ask for. No stored state: from 0, and take the baseline below.
    let startId = comp.startId;
    const lastId = comp.lastId ?? (startId !== null ? startId - 1 : null);
    const baseline = lastId === null;
    const askedFrom = lastId ?? 0;

    const body = await fetchRows(unitId, askedFrom);
    // Received = when the response was in, not when the request left.
    const receivedAtMs = now();
    const { rows, malformed } = parseRocResponse(body);
    const fresh = rows.filter((r) => r.id > askedFrom).sort((a, b) => a.id - b.id);

    const batch: RocBatch = {
      received: fresh.length,
      inserted: 0,
      duplicates: 0,
      dateMismatches: 0,
      skipped: 0,
      malformed,
    };

    if (baseline) {
      // Everything that exists now is history. Rows that arrive from the next
      // poll on count, also when ROC is empty now (start id 1, last id 0).
      const maxNow = fresh.length > 0 ? fresh[fresh.length - 1]!.id : 0;
      startId = maxNow + 1;
    }

    const toStore: RocRow[] = [];
    for (const r of fresh) {
      if (startId !== null && r.id < startId) batch.skipped++;
      else toStore.push(r);
    }

    const apply = handle.sqlite.transaction((): boolean => {
      // The operator may have changed the settings while the request was out
      // (new unit, new start id, off): then this response belongs to the old
      // settings and must not touch the new cursor.
      const now2 = readCursor(competitionId);
      if (
        !now2 ||
        !now2.enabled ||
        now2.unitId !== unitId ||
        now2.startId !== comp.startId ||
        now2.lastId !== comp.lastId
      ) {
        return false;
      }
      for (const r of toStore) {
        const placed = placeTimeOfDay(r.time, receivedAtMs);
        const dateMismatch = r.date !== comp.date;
        try {
          insertEvent(
            handle,
            nodeId,
            'radio_punch',
            placed.epochMs,
            {
              event_type: 'radio_punch',
              source: 'roc',
              idempotency_key: `${unitId}:${r.id}`,
              roc_id: r.id,
              card_number: r.card,
              control_code: r.code,
              time_of_day: r.time,
              wall_ms: placed.wallMs,
              received_at_ms: receivedAtMs,
              roc_date: r.date,
              date_mismatch: dateMismatch,
            },
            competitionId
          );
          batch.inserted++;
          if (dateMismatch) batch.dateMismatches++;
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          batch.duplicates++;
        }
      }
      // In the same transaction as the inserts: cursor and rows move together.
      const maxId = baseline ? startId! - 1 : fresh.length > 0 ? fresh[fresh.length - 1]!.id : null;
      if (maxId !== null || startId !== comp.startId) {
        handle.db
          .update(competitions)
          .set({ rocLastId: maxId ?? comp.lastId, rocStartId: startId })
          .where(eq(competitions.id, competitionId))
          .run();
      }
      return true;
    });
    return apply() ? batch : null;
  }

  async function tickOne(id: string): Promise<void> {
    const rt = runtime(id);
    rt.inFlight = true;
    rt.lastPollAt = now();
    try {
      const batch = await pollOnce(id);
      if (batch !== null) {
        rt.lastBatch = batch;
        rt.lastSuccessAt = now();
        rt.lastError = null;
        rt.consecutiveFailures = 0;
      }
      rt.nextAt = now() + intervalMs;
    } catch (e) {
      rt.consecutiveFailures++;
      rt.lastError = e instanceof Error ? e.message : String(e);
      rt.nextAt = now() + nextDelayMs(rt.consecutiveFailures, intervalMs, maxBackoffMs);
      opts.log?.warn({ competitionId: id, err: rt.lastError }, 'ROC poll failed');
    } finally {
      rt.inFlight = false;
    }
  }

  function tick(): void {
    const enabled = handle.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.rocEnabled, true))
      .all();
    for (const { id } of enabled) {
      const rt = runtime(id);
      if (!rt.inFlight && rt.nextAt <= now()) void tickOne(id);
    }
  }

  return {
    pollOnce,
    start() {
      if (timer === null) {
        timer = setInterval(tick, TICK_MS);
        timer.unref();
      }
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    status(id) {
      const { lastPollAt, lastSuccessAt, lastError, consecutiveFailures, lastBatch } = runtime(id);
      return { lastPollAt, lastSuccessAt, lastError, consecutiveFailures, lastBatch };
    },
  };
}
