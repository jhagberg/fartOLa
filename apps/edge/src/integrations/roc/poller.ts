// Authored for fartola. Not ported from upstream.
//
// ROC poller: GET getpunches.asp?unitId=<roc id>&lastId=<n>, one request per
// competition per poll. NEVER sends date/time: the server filters on
// timestamp, and a sender with a wrong clock stamps rows with another date
// (2026-10-04, 18h50m behind) which the filter then hides.
//
// - Rows from before the competition are skipped by id, never by timestamp.
//   The ROC date is read exactly once, on the very first poll with no stored
//   state, to find where today's rows start (competitions.roc_start_id,
//   or set by hand). After that every decision is by id.
// - Only the time of day is used (place.ts); a row whose date is not the
//   competition date is stored with date_mismatch=true, never dropped.
// - Dedup on (card, code, time of day) via the idempotency key and the unique
//   index from migration 0018.
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

  async function pollOnce(competitionId: string): Promise<RocBatch | null> {
    const comp = handle.db
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
    if (!comp || !comp.enabled || !comp.unitId) return null;

    // lastId to ask for. No stored state: from 0, and find the start below.
    let startId = comp.startId;
    const lastId = comp.lastId ?? (startId !== null ? startId - 1 : null);
    const baseline = lastId === null;
    const askedFrom = lastId ?? 0;

    const receivedAtMs = now();
    const { rows, malformed } = parseRocResponse(await fetchRows(comp.unitId, askedFrom));
    const fresh = rows.filter((r) => r.id > askedFrom).sort((a, b) => a.id - b.id);

    const batch: RocBatch = {
      received: fresh.length,
      inserted: 0,
      duplicates: 0,
      dateMismatches: 0,
      skipped: 0,
      malformed,
    };

    if (baseline && fresh.length > 0) {
      // First ever poll: today's rows start at the first row with the
      // competition date; with none, everything so far is history.
      const firstToday = fresh.find((r) => r.date === comp.date);
      startId = firstToday ? firstToday.id : fresh[fresh.length - 1]!.id + 1;
    }

    const toStore: RocRow[] = [];
    for (const r of fresh) {
      if (startId !== null && r.id < startId) batch.skipped++;
      else toStore.push(r);
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
            idempotency_key: `${r.card}:${r.code}:${r.time}`,
            roc_id: r.id,
            card_number: r.card,
            control_code: r.code,
            time_of_day: r.time,
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

    // After the inserts: a crash in between re-fetches the rows and the
    // unique index swallows the repeats.
    const maxId = fresh.length > 0 ? fresh[fresh.length - 1]!.id : null;
    if (maxId !== null || startId !== comp.startId) {
      handle.db
        .update(competitions)
        .set({
          rocLastId: maxId ?? comp.lastId,
          rocStartId: startId,
        })
        .where(eq(competitions.id, competitionId))
        .run();
    }
    return batch;
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
