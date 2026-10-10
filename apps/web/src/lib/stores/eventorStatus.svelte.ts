// Authored for fartola. Not ported from upstream.
//
// Svelte 5 runes store mirroring bridgeStatus.svelte.ts. Backs the
// settings-page Eventor status line (Plan 02-02 task 4).
//
//   getEventorStatus() returns the current snapshot (state, ageDays,
//   competitorCount, fartola_dev, refreshing flag). On mount
//   the status line calls refreshEventorStatus() once to prime the
//   line; clicking the FARTOLA_DEV-gated "Uppdatera" button calls
//   triggerEventorRefresh() which optimistically flips state to
//   'refreshing' then re-fetches the status to land the truth.
//
// Soft-fail semantics:
//   - refreshEventorStatus catches network errors and sets
//     state='offline' so the UI never hard-fails when the bridge is
//     down between page loads.
//   - triggerEventorRefresh catches network errors so a click on the
//     admin button never throws into the global error boundary.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-02-PLAN.md task 4
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-EV-3
//   (warn-and-run; never block UI on cache absence)

import { getEventorStatus as fetchEventorStatus } from '#lib/api/client.ts';

export type EventorStatusVisible =
  'unknown' | 'ready' | 'stale' | 'offline' | 'no_key' | 'refreshing';

export interface EventorStatusState {
  state: EventorStatusVisible;
  ageDays: number | null;
  competitorCount: number;
  /** Mirrors the server's fartola_dev — the status line gates the
   * "Uppdatera" button on this so production builds don't show it. */
  fartola_dev: boolean;
}

let _state = $state<EventorStatusState>({
  state: 'unknown',
  ageDays: null,
  competitorCount: 0,
  fartola_dev: false,
});

/** Returns the current snapshot. Reactive consumers (Svelte components)
 * MUST destructure inside a $derived(...) so the rune dependency is
 * tracked. */
export function getEventorStatus(): EventorStatusState {
  return _state;
}

/** Soft setter for tests + the admin refresh trigger. NOT exported as
 * part of the public store surface in production paths. */
export function _setEventorStatus(next: Partial<EventorStatusState>): void {
  _state = { ..._state, ...next };
}

/** Fetch the latest status from /api/eventor/status. Catches network
 * failures and sets state='offline' so the UI never hard-fails. */
export async function refreshEventorStatus(): Promise<void> {
  try {
    const r = await fetchEventorStatus();
    _state = {
      state: r.state,
      ageDays: r.ageDays,
      competitorCount: r.competitorCount,
      fartola_dev: r.fartola_dev,
    };
  } catch {
    _state = {
      ..._state,
      state: 'offline',
    };
  }
}

/** POST /api/__admin/eventor/refresh (FARTOLA_DEV-gated server-side).
 * Optimistically flips state to 'refreshing' so the line shows feedback
 * immediately, then re-fetches the status after the admin endpoint
 * returns. */
export async function triggerEventorRefresh(): Promise<void> {
  _state = { ..._state, state: 'refreshing' };
  try {
    const res = await fetch('/api/__admin/eventor/refresh', { method: 'POST' });
    // 404 happens when FARTOLA_DEV is not set; either way we re-fetch the
    // status to surface the truth (no_key/offline/ready depending on
    // server state).
    void res;
  } catch {
    // Network-down — leave the state as 'refreshing' briefly and let
    // the status refresh land the truth.
  } finally {
    await refreshEventorStatus();
  }
}
