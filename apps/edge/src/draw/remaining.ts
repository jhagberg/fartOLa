// Ported from MeOS code/oEventDraw.cpp (melinsoftware/meos, GPL-3.0-or-later).
// Copyright (C) Melin Software HB and contributors. Modified for fartOLa 2026-10-07.
//
// Late entrants (efteranmälda) in a class that already has a start list,
// without redrawing it (SOFT TR 7.5.7, TR 7.5.8). From oEvent::drawList,
// DrawType::RemainingBefore/RemainingAfter (oEventDraw.cpp:2498-2550):
// the runners without a start time start in a block just before the first
// start (day: "starta först") or just after the last (night: "sist"), at
// the class interval. MeOS infers the interval as the smallest gap between
// the starts (:2525-2533); fartOLa uses the class's stored interval first.
// MeOS falls back to 01:00 and 2 minutes when it cannot infer (:2544-2548);
// fartOLa refuses instead (DrawError), so nobody gets a start at 01:00.
//
// fartOLa additions: the block is reversed when that avoids a same-club
// neighbour at the seam (TR 7.5.1), and fillVacancies puts late entrants
// into free places of the class's start grid (TR 7.5.8: "vakanta
// platser", not in elite classes; the route checks the class kind).

import crypto from 'node:crypto';

import type { DrawRunner, RngFn } from './types.ts';
import { DrawError } from './types.ts';

/** A runner who already has a start time in the class. */
export interface StartedRunner {
  id: string;
  club: string | null;
  startTimeMs: number;
}

export interface Assignment {
  id: string;
  startTimeMs: number;
}

/** The smallest positive gap between the start times, or null when there
 * are fewer than two distinct times (oEventDraw.cpp:2525-2533). */
export function smallestGapMs(startTimesMs: readonly number[]): number | null {
  const times = [...new Set(startTimesMs)].sort((a, b) => a - b);
  let gap: number | null = null;
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (gap === null || d < gap) gap = d;
  }
  return gap;
}

const sameClub = (a: { club: string | null } | undefined, b: { club: string | null } | undefined) =>
  a !== undefined && b !== undefined && a.club !== null && a.club === b.club;

/** MeOS RemainingBefore/RemainingAfter: `order` (the late entrants, already
 * drawn) starts in a block before the first or after the last start. */
export function placeBeforeOrAfter(
  existing: readonly StartedRunner[],
  order: readonly DrawRunner[],
  placement: 'Before' | 'After',
  intervalMs: number,
  rng: RngFn = (min, max) => crypto.randomInt(min, max)
): Assignment[] {
  if (order.length === 0) return [];
  if (existing.length === 0)
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  const byTime = [...existing].sort((a, b) => a.startTimeMs - b.startTimeMs);
  const first = byTime[0]!;
  const last = byTime[byTime.length - 1]!;
  // Same-club neighbours in a candidate block, counting the seam to the
  // existing list (before → block's last meets the first start; after →
  // block's first meets the last).
  const clashes = (b: readonly DrawRunner[]): number => {
    let n = 0;
    for (let i = 1; i < b.length; i++) if (sameClub(b[i - 1], b[i])) n++;
    const seam = placement === 'Before' ? sameClub(b[b.length - 1], first) : sameClub(b[0], last);
    return n + (seam ? 1 : 0);
  };
  // The drawn order first, then its reverse, then random orders (rejection
  // sampling keeps every clash-free order equally likely, TR 7.5.2). Reversal
  // alone cannot help when both ends are from the boundary runner's club.
  let block = [...order];
  let best = clashes(block);
  const candidates = function* (): Generator<DrawRunner[]> {
    yield [...order].reverse();
    for (let k = 0; k < 300; k++) {
      const c = [...order];
      for (let i = c.length - 1; i > 0; i--) {
        const j = rng(0, i + 1);
        [c[i], c[j]] = [c[j]!, c[i]!];
      }
      yield c;
    }
  };
  if (best > 0)
    for (const c of candidates()) {
      const n = clashes(c);
      if (n < best) {
        block = c;
        best = n;
        if (best === 0) break;
      }
    }
  const start =
    placement === 'Before'
      ? first.startTimeMs - block.length * intervalMs
      : last.startTimeMs + intervalMs;
  return block.map((r, i) => ({ id: r.id, startTimeMs: start + i * intervalMs }));
}

/** Late entrants into free places of the start grid first + k·interval,
 * k from 0 to the last start. Each takes a random free place, preferring
 * one where neither nearest starter is from the same club (TR 7.5.1).
 * Late entrants beyond the free places start right after the last start
 * (TR 7.5.7: there is always room), in order. */
export function fillVacancies(
  existing: readonly StartedRunner[],
  late: readonly DrawRunner[],
  grid: { firstStartMs: number; intervalMs: number },
  rng: RngFn
): Assignment[] {
  if (late.length === 0) return [];
  if (existing.length === 0)
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  // floor: a hand-edited off-grid start occupies the place it falls in, so a
  // late entrant never lands before it.
  const slotOf = (t: number) => Math.floor((t - grid.firstStartMs) / grid.intervalMs);
  const taken = new Map<number, string | null>();
  for (const r of existing) taken.set(slotOf(r.startTimeMs), r.club);
  const lastSlot = Math.max(...taken.keys());
  const free: number[] = [];
  for (let k = 0; k <= lastSlot; k++) if (!taken.has(k)) free.push(k);
  for (let i = free.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  const neighbourClubs = (k: number): Array<string | null> => {
    const out: Array<string | null> = [];
    for (const dir of [-1, 1])
      for (let s = k + dir; s >= 0 && s <= lastSlot; s += dir)
        if (taken.has(s)) {
          out.push(taken.get(s)!);
          break;
        }
    return out;
  };
  let after = lastSlot;
  return late.map((r) => {
    let k: number;
    if (free.length > 0) {
      const pick = free.findIndex((f) => r.club === null || !neighbourClubs(f).includes(r.club));
      k = free.splice(pick === -1 ? 0 : pick, 1)[0]!;
      taken.set(k, r.club);
    } else k = ++after;
    return { id: r.id, startTimeMs: grid.firstStartMs + k * grid.intervalMs };
  });
}
