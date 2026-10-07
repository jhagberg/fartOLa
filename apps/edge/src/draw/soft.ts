// Authored for fartola. Not ported from upstream.
//
// SOFT club-separating draw. Written for fartOLa (c684d95), not from MeOS:
// MeOS's drawSOFTMethod (MeOS code/oEventDraw.cpp:130-209) leaves avoidable
// same-club neighbours and repeats few club patterns (draw benchmark,
// apps/edge/scripts/draw-benchmark.ts), so it fails SOFT TR 7.5.1/7.5.2
// (ADR-0011).
//
// D-04: drawSOFT produces a random permutation with the fewest adjacent
// same-club runners possible: zero when no club exceeds half the class,
// else 2·M − n − 1 (SOFT TR 7.5.1).
//
// D-06: Vakanta startplatser are distributed as null-competitor gaps in the
// draw order, in random gaps (vacancies.ts).
//
// T-02.1-05 (DoS): uses an iterative binning approach — zero stack overflow
// risk regardless of class size.
//
// Phase 2.1 D-03/D-04.

import crypto from 'node:crypto';
import type { DrawRunner, DrawResult, DrawSlot, RngFn, VacantPosition } from './types.ts';
import { placeVacancies } from './vacancies.ts';

/** Options for drawSOFT. */
export interface DrawSOFTOptions {
  /** Number of vacant (null) slots to insert. Defaults to 0. */
  vacantSlots?: number;
  /** Where the vacant slots go (default 'Mixed', see vacancies.ts). */
  vacantPosition?: VacantPosition;
  /**
   * Optional RNG injection for reproducible tests.
   * Signature: (min: number, max: number) => number (returns integer in [min, max)).
   * Defaults to crypto.randomInt (CSPRNG).
   */
  rngFn?: RngFn;
}

/**
 * SOFT club-blocking draw (SOFT TR 7.5.1 (2026-07-01): runners from the same
 * club "ska om möjligt inte starta direkt efter varandra").
 *
 * The fewest same-club neighbours possible is max(0, 2·M − n − 1), M the
 * largest club, n the class. Algorithm:
 * 1. Group runners by club; a runner without a club is a group of one.
 * 2. Shuffle within each group; order the groups by size, ties at random.
 * 3. An optimal start order: when M ≤ ⌈n/2⌉, deal the groups, largest
 *    first, into slots 0, 2, 4, … then 1, 3, 5, … (no neighbours). When M
 *    is larger, the other runners take slots 1, 3, …, 2(n−M)−1 and the
 *    largest club the rest (2M − n − 1 neighbours).
 * 4. Randomise: swap two random runners whenever that adds no same-club
 *    neighbour. The swaps are symmetric, so the draw wanders over the
 *    optimal orders at random and repeated draws differ (TR 7.5.2).
 *    Then reverse the order with probability ½: step 3 always starts the
 *    largest club in slot 0, and when it fills half the class the swaps
 *    cannot move it off the even slots (TR 7.5.2: A×5/B×3/C×2 started
 *    with A in 91 % of draws, 77 % of the valid orders do).
 * 5. Place vacant null slots (vacancies.ts).
 * 6. Count adjacencies and return.
 */
export function drawSOFT(runners: DrawRunner[], opts: DrawSOFTOptions = {}): DrawResult {
  const rng = opts.rngFn ?? ((min, max) => crypto.randomInt(min, max));
  const vacantSlots = opts.vacantSlots ?? 0;
  const vacantPosition = opts.vacantPosition ?? 'Mixed';

  if (runners.length === 0) {
    return { order: [], adjacencyCount: 0 };
  }

  // --- Step 1: Group by club ---
  // null-club runners each become a singleton group with a unique key so they
  // never merge with each other or count as "same club" adjacency.
  const groupMap = new Map<string, DrawRunner[]>();
  for (const r of runners) {
    const key = r.club !== null ? r.club : `__null_${r.id}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.push(r);
    } else {
      groupMap.set(key, [r]);
    }
  }

  // --- Step 2: Shuffle within groups; groups by size, ties at random ---
  const groups: DrawRunner[][] = Array.from(groupMap.values());
  for (const g of groups) fisherYatesShuffle(g, rng);
  fisherYatesShuffle(groups, rng);
  groups.sort((a, b) => b.length - a.length); // stable: equal sizes stay shuffled

  // --- Step 3: An optimal order ---
  const n = runners.length;
  const largest = groups[0]!;
  const others = groups.slice(1).flat();
  const order: DrawRunner[] = new Array<DrawRunner>(n);
  if (largest.length <= Math.ceil(n / 2)) {
    const all = [largest, ...groups.slice(1)].flat();
    let slot = 0;
    for (const r of all) {
      order[slot] = r;
      slot += 2;
      if (slot >= n) slot = 1;
    }
  } else {
    let li = 0;
    for (let slot = 0; slot < n; slot++) {
      const odd = slot % 2 === 1 && (slot - 1) / 2 < others.length;
      order[slot] = odd ? others[(slot - 1) / 2]! : largest[li++]!;
    }
  }

  // --- Step 4: Randomise without adding neighbours ---
  const same = (a: DrawRunner, b: DrawRunner): boolean => a.club !== null && a.club === b.club;
  const around = (i: number, j: number): number => {
    let c = 0;
    for (const p of new Set([i - 1, i, j - 1, j])) {
      if (p >= 0 && p + 1 < n && same(order[p]!, order[p + 1]!)) c++;
    }
    return c;
  };
  for (let k = 0; k < 50 * n && n > 1; k++) {
    const i = rng(0, n);
    const j = rng(0, n);
    if (i === j || same(order[i]!, order[j]!)) continue;
    const before = around(i, j);
    [order[i], order[j]] = [order[j]!, order[i]!];
    if (around(i, j) > before) [order[i], order[j]] = [order[j]!, order[i]!];
  }

  if (rng(0, 2) === 1) order.reverse();

  // --- Step 5: Place vacant slots ---
  const result: DrawSlot[] = placeVacancies(order, vacantSlots, vacantPosition, rng);

  // --- Step 6: Count adjacencies among non-null slots ---
  const adjacencyCount = countAdjacencies(result);

  return { order: result, adjacencyCount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates in-place shuffle. */
function fisherYatesShuffle<T>(arr: T[], rng: RngFn): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    // i and j are bounded by arr.length, so these indexes are in range.
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/** Count adjacent pairs in the slot sequence where both runners share a club. */
function countAdjacencies(slots: DrawSlot[]): number {
  let count = 0;
  const real = slots.filter((s): s is DrawRunner => s !== null);
  for (let i = 0; i < real.length - 1; i++) {
    // The loop stops before the last element, so i and i + 1 are in range.
    if (real[i]!.club !== null && real[i]!.club === real[i + 1]!.club) count++;
  }
  return count;
}
