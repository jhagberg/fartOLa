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
// fartOLa additions: seamClubs gives the club next to the block, so the
// SOFT draw of the block (drawSOFT boundary) counts a same-club neighbour
// at the seam and draws uniformly among the orders with the fewest
// (TR 7.5.1, TR 7.5.2); fillVacancies puts late entrants into free places
// of the class's start grid (TR 7.5.8: "vakanta platser", not in elite
// classes; the route checks the class kind), and draws those beyond the
// free places the same way with the last starter's club as the seam.

import { drawSOFT } from './soft.ts';
import type { DrawBoundary } from './soft.ts';
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

/** The club of the starter next to the block: the first start for
 * 'Before' (the block ends just before it), the last for 'After'. Pass it
 * to drawSOFT as its boundary. */
export function seamClubs(
  existing: readonly StartedRunner[],
  placement: 'Before' | 'After'
): DrawBoundary {
  if (existing.length === 0) return {};
  const byTime = [...existing].sort((a, b) => a.startTimeMs - b.startTimeMs);
  return placement === 'Before'
    ? { after: byTime[0]!.club }
    : { before: byTime[byTime.length - 1]!.club };
}

/** MeOS RemainingBefore/RemainingAfter: `order` (the late entrants, already
 * drawn) starts in a block before the first or after the last start. */
export function placeBeforeOrAfter(
  existing: readonly StartedRunner[],
  order: readonly DrawRunner[],
  placement: 'Before' | 'After',
  intervalMs: number
): Assignment[] {
  if (order.length === 0) return [];
  if (existing.length === 0)
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  const times = existing.map((r) => r.startTimeMs);
  const start =
    placement === 'Before'
      ? Math.min(...times) - order.length * intervalMs
      : Math.max(...times) + intervalMs;
  return order.map((r, i) => ({ id: r.id, startTimeMs: start + i * intervalMs }));
}

/** Late entrants into free places of the start grid first + k·interval,
 * k from 0 to the last start. Each takes a random free place, preferring
 * one where neither nearest starter is from the same club (TR 7.5.1).
 * Late entrants beyond the free places start right after the last start
 * (TR 7.5.7: there is always room): in order, or with `separateClubs`
 * (SOFT) drawn again with the last starter's club as the seam (drawSOFT
 * boundary), so the block has the fewest same-club neighbours. */
export function fillVacancies(
  existing: readonly StartedRunner[],
  late: readonly DrawRunner[],
  grid: { firstStartMs: number; intervalMs: number },
  rng: RngFn,
  separateClubs = false
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
  const placed = late.slice(0, free.length).map((r) => {
    const pick = free.findIndex((f) => r.club === null || !neighbourClubs(f).includes(r.club));
    const k = free.splice(pick === -1 ? 0 : pick, 1)[0]!;
    taken.set(k, r.club);
    return { id: r.id, startTimeMs: grid.firstStartMs + k * grid.intervalMs };
  });
  // Free places all lie before the last start, so lastSlot is a starter's.
  const rest = late.slice(placed.length);
  const block =
    separateClubs && rest.length > 0
      ? (drawSOFT([...rest], { boundary: { before: taken.get(lastSlot) ?? null }, rngFn: rng })
          .order as DrawRunner[])
      : rest;
  return [
    ...placed,
    ...block.map((r, i) => ({
      id: r.id,
      startTimeMs: grid.firstStartMs + (lastSlot + 1 + i) * grid.intervalMs,
    })),
  ];
}
