// Ported from MeOS code/oEventDraw.cpp (melinsoftware/meos, GPL-3.0-or-later).
// Copyright (C) Melin Software HB and contributors. Modified for fartOLa 2026-10-07.
//
// Pursuit (jaktstart) and reverse pursuit (omvänd jaktstart), SOFT TR 7.4.1.
// From oEvent::drawPersuitList (oEventDraw.cpp:3063-3167):
// - Runners are sorted by their previous-stage time; only status OK with a
//   time counts, the rest sort last (:3107-3124, MeOS by status code).
// - Pursuit: start = first start + (time − leader's time). Reverse: the
//   slowest runner inside the limit starts first and the leader last
//   (:3126-3150).
// - A runner more than `maxBehindMs` behind the leader, or without a time,
//   starts in the restart block (omstart) at restart time + k·interval,
//   in result order; in reverse pursuit the block runs worst first
//   (:3147-3162).
// Modified: no pair start (MeOS pairSize), so MeOS's `odd` term, which
// leaves the first restart place empty in a reverse pursuit with an odd
// number of runners (:3155-3161), is dropped. No patrols (:3091-3105).
// Times are scaled and rounded to whole seconds (SOFT TR 4.20.7), not to
// MeOS's tenths. The SOFT ban on pursuit in some classes is the route's
// job (classKind.ts pursuitBanned).

export interface PursuitRunner {
  id: string;
  /** Running time in the previous stage, ms; null when there is none. */
  previousTimeMs: number | null;
  /** True when the previous stage's status was OK. */
  previousOk: boolean;
}

export interface PursuitOptions {
  firstStartMs: number;
  restartMs: number;
  /** Runners this far or further behind the leader go to the restart block. */
  maxBehindMs: number;
  /** Interval in the restart block. */
  intervalMs: number;
  reverse: boolean;
  /** Time factor (MeOS "scale"), default 1. */
  scale?: number;
}

export interface PursuitResult {
  assignments: Array<{ id: string; startTimeMs: number }>;
  /** How many start in the restart block. */
  restarted: number;
}

const NO_TIME = Number.MAX_SAFE_INTEGER;

export function drawPursuit(
  runners: readonly PursuitRunner[],
  opts: PursuitOptions
): PursuitResult {
  const scale = opts.scale ?? 1;
  const times = runners.map((r, k) => ({
    k,
    t:
      r.previousOk && r.previousTimeMs !== null && r.previousTimeMs > 0
        ? Math.round((r.previousTimeMs * scale) / 1000) * 1000
        : NO_TIME,
  }));
  // Array.prototype.sort is stable: equal times keep the input order.
  times.sort((a, b) => a.t - b.t);
  if (times.length === 0) return { assignments: [], restarted: 0 };

  const delta = times[0]!.t === NO_TIME ? 0 : times[0]!.t;
  const inside = (t: number) => t !== NO_TIME && t - delta < opts.maxBehindMs;
  let reverseDelta = 0;
  if (opts.reverse) for (const x of times) if (inside(x.t)) reverseDelta = x.t;

  const assignments: Array<{ id: string; startTimeMs: number }> = [];
  let breakIndex = -1;
  let restarted = 0;
  times.forEach(({ k, t }, i) => {
    let start: number;
    if (inside(t) && breakIndex === -1) {
      start = opts.reverse ? opts.firstStartMs - t + reverseDelta : opts.firstStartMs + t - delta;
    } else {
      restarted++;
      if (!opts.reverse) {
        if (breakIndex === -1) breakIndex = i;
        start = opts.restartMs + (i - breakIndex) * opts.intervalMs;
      } else {
        if (breakIndex === -1) breakIndex = times.length - 1;
        start = opts.restartMs + (breakIndex - i) * opts.intervalMs;
      }
    }
    assignments.push({ id: runners[k]!.id, startTimeMs: start });
  });
  return { assignments, restarted };
}
