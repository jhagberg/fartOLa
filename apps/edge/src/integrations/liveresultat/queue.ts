// Authored for fartola. Not ported from upstream.
//
// In-memory push queue for liveresultat result pushes.
//
// Architecture (PATTERNS.md S-7):
//
//   createPushQueue(opts) → PushQueueHandle
//   PushQueueHandle.enqueue(competitionId) → schedules debounced push
//   PushQueueHandle.stop() → clears all timers
//   PushQueueHandle.status() → { lastPushAt, lastSuccessAt, lastError, queueSize, retryCount }
//
// Debounce semantics (addresses Gemini HIGH review — per-punch congestion):
//   - enqueue(competitionId) schedules a push AFTER debounceMs (default 15_000 ms).
//   - Multiple calls within the window are coalesced: only one push fires,
//     always using the LATEST snapshot so stale data never overwrites fresh data.
//   - The pending timer is replaced on each call; no stale closures.
//
// Retry semantics (T-02.1-14 mitigate):
//   - On failure: exponential backoff (retryDelayMs * 2^attempt), capped at maxRetries.
//   - Max 3 retries by default. After that the queue is idle until next enqueue().
//   - stop() clears all pending timers immediately.
//
// Known limitation (T-02.1-14b accept):
//   In-memory only. Queue state is lost on server crash/restart. This is
//   acceptable for Phase 2.1 because:
//   (1) auto-push re-triggers on next card_read (the queue recovers naturally),
//   (2) liveresultat is idempotent — re-pushing the same snapshot is safe,
//   (3) operator can trigger a manual push via POST .../liveresultat/push.
//   Phase 2.2 candidate: persist last_push_at + retry_count to SQLite.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 2
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-PATTERNS.md S-7
// - REQ-STD-004

import type { FastifyBaseLogger } from 'fastify';
import type { CompetitionState } from '../../projection/types.ts';
import type { MopBuildInput } from './mopBuilder.ts';
import { buildMopXml } from './mopBuilder.ts';
import { pushToLiveresultat } from './push.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushQueueStatus {
  lastPushAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  queueSize: number;
  retryCount: number;
}

export interface PushQueueHandle {
  /** Schedule a debounced push for the given competition. Coalesces rapid calls. */
  enqueue(competitionId: string): void;
  /** Cancel all pending timers. Call during server shutdown. */
  stop(): void;
  /** Snapshot of the queue state for the status endpoint. */
  status(): PushQueueStatus;
}

export interface PushQueueConfig {
  /** Liveresultat numeric competition ID. */
  liveresultatId: string;
  /** Liveresultat upload password. */
  liveresultatPwd: string;
  /** Liveresultat push endpoint URL. Default production URL. */
  liveresultatUrl?: string;
}

export interface PushQueueOpts {
  /** Get the current projection state for a competition. Returns null if unknown. */
  getProjection: (competitionId: string) => CompetitionState | null;
  /** Get liveresultat config for a competition (id + pwd). Returns null when not configured. */
  getConfig: (competitionId: string) => PushQueueConfig | null;
  /** Get class/club metadata needed for MOP XML building. */
  getMopMeta: (
    competitionId: string
  ) => { classes: MopBuildInput['classes']; clubs: MopBuildInput['clubs'] } | null;
  /** Fastify logger for warn/info output. */
  log: FastifyBaseLogger;
  /** Debounce window in ms. Default 15_000 ms (15 s). */
  debounceMs?: number;
  /** Delay before first retry after failure in ms. Default 5_000 ms. */
  retryDelayMs?: number;
  /** Maximum retry attempts. Default 3. */
  maxRetries?: number;
  /** Fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_LIVERESULTAT_URL = 'http://liveresultat.orientering.se/api/update.php';
const DEFAULT_DEBOUNCE_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPushQueue(opts: PushQueueOpts): PushQueueHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  // One debounce timer per competitionId. When a new enqueue() call arrives
  // within the window, the existing timer is cleared and replaced.
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  // One retry timer per competitionId (at most one retry in flight at a time).
  const retryTimers = new Map<string, NodeJS.Timeout>();

  // Status tracking (per queue, not per competition — this is a single-competition
  // queue in practice because each Fastify instance is for one active competition).
  let lastPushAt: number | null = null;
  let lastSuccessAt: number | null = null;
  let lastError: string | null = null;
  let retryCount = 0;

  function clearCompetitionTimers(competitionId: string): void {
    const dt = debounceTimers.get(competitionId);
    if (dt !== undefined) {
      clearTimeout(dt);
      debounceTimers.delete(competitionId);
    }
    const rt = retryTimers.get(competitionId);
    if (rt !== undefined) {
      clearTimeout(rt);
      retryTimers.delete(competitionId);
    }
  }

  async function attemptPush(competitionId: string, attempt: number): Promise<void> {
    const state = opts.getProjection(competitionId);
    if (state === null) {
      opts.log.warn({ competitionId }, 'liveresultat push skipped: no projection state');
      return;
    }

    const config = opts.getConfig(competitionId);
    if (config === null) {
      opts.log.warn({ competitionId }, 'liveresultat push skipped: no liveresultat config');
      return;
    }

    const meta = opts.getMopMeta(competitionId);
    if (meta === null) {
      opts.log.warn({ competitionId }, 'liveresultat push skipped: no class/club metadata');
      return;
    }

    const mopXml = buildMopXml({
      state,
      competition: { id: config.liveresultatId, name: '', date: '' },
      classes: meta.classes,
      clubs: meta.clubs,
    });

    const url = config.liveresultatUrl ?? DEFAULT_LIVERESULTAT_URL;

    lastPushAt = Date.now();
    try {
      await pushToLiveresultat({
        url,
        competitionId: config.liveresultatId,
        password: config.liveresultatPwd,
        mopXml,
        fetchImpl: opts.fetchImpl,
      });
      lastSuccessAt = Date.now();
      lastError = null;
      retryCount = 0;
      opts.log.info({ competitionId }, 'liveresultat push succeeded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      opts.log.warn({ competitionId, attempt, err: msg }, 'liveresultat push failed');

      if (attempt < maxRetries) {
        retryCount++;
        // Exponential backoff: retryDelayMs * 2^attempt (capped implicitly by maxRetries)
        const delay = retryDelayMs * Math.pow(2, attempt);
        opts.log.info(
          { competitionId, delay, nextAttempt: attempt + 1 },
          'liveresultat push retry scheduled'
        );
        const timer = setTimeout(() => {
          retryTimers.delete(competitionId);
          void attemptPush(competitionId, attempt + 1);
        }, delay);
        retryTimers.set(competitionId, timer);
      } else {
        opts.log.warn(
          { competitionId, maxRetries },
          'liveresultat push exhausted retries; will retry on next enqueue'
        );
        retryCount = 0; // Reset so next enqueue starts fresh
      }
    }
  }

  function enqueue(competitionId: string): void {
    // Cancel any existing debounce timer for this competition (coalesce).
    // Also cancel any pending retry — the fresh enqueue supersedes it.
    clearCompetitionTimers(competitionId);
    retryCount = 0; // Reset retry counter on new enqueue

    const timer = setTimeout(() => {
      debounceTimers.delete(competitionId);
      void attemptPush(competitionId, 0);
    }, debounceMs);
    debounceTimers.set(competitionId, timer);
  }

  function stop(): void {
    // Clear all debounce and retry timers.
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
    for (const timer of retryTimers.values()) {
      clearTimeout(timer);
    }
    retryTimers.clear();
  }

  function status(): PushQueueStatus {
    return {
      lastPushAt,
      lastSuccessAt,
      lastError,
      queueSize: debounceTimers.size + retryTimers.size,
      retryCount,
    };
  }

  return { enqueue, stop, status };
}
