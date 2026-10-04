// Authored for fartola. Not ported from upstream.
//
// SOFT club-blocking draw algorithm re-authored from the algorithm described
// in oEventDraw.cpp:130-209 (NOT ported — re-authored against the algorithm).
//
// D-04: drawSOFT produces a random permutation with the fewest adjacent
// same-club runners possible: zero when no club exceeds half the class,
// else 2·M − n − 1 (SOFT TR 7.5.1).
//
// D-06: Vakanta startplatser are distributed as null-competitor gaps in the
// draw order (evenly spread via interleaving).
//
// T-02.1-05 (DoS): uses an iterative binning approach — zero stack overflow
// risk regardless of class size.
//
// Phase 2.1 D-03/D-04.

import crypto from 'node:crypto';
import type { DrawRunner, DrawResult, DrawSlot } from './types.ts';

/** Options for drawSOFT. */
export interface DrawSOFTOptions {
  /** Number of vacant (null) slots to insert. Defaults to 0. */
  vacantSlots?: number;
  /**
   * Optional RNG injection for reproducible tests.
   * Signature: (min: number, max: number) => number (returns integer in [min, max)).
   * Defaults to crypto.randomInt (CSPRNG).
   */
  rngFn?: (min: number, max: number) => number;
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
 * 5. Insert vacant null slots evenly across the result.
 * 6. Count adjacencies and return.
 */
export function drawSOFT(runners: DrawRunner[], opts: DrawSOFTOptions = {}): DrawResult {
  const rng = opts.rngFn ?? ((min, max) => crypto.randomInt(min, max));
  const vacantSlots = opts.vacantSlots ?? 0;

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

  // --- Step 5: Insert vacant slots evenly ---
  const result: DrawSlot[] = insertVacants(order, vacantSlots);

  // --- Step 6: Count adjacencies among non-null slots ---
  const adjacencyCount = countAdjacencies(result);

  return { order: result, adjacencyCount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates in-place shuffle. */
function fisherYatesShuffle<T>(arr: T[], rng: (min: number, max: number) => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    // i and j are bounded by arr.length, so these indexes are in range.
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Distribute `count` null (vacant) slots evenly into the runner sequence.
 * Uses Bresenham-style spacing: each vacant is placed at index
 * round((i + 0.5) * total / count) in the final slot array.
 */
function insertVacants(runners: DrawRunner[], count: number): DrawSlot[] {
  if (count <= 0) return runners;

  const total = runners.length + count;
  // Compute desired positions for vacants (evenly spaced).
  const vacantPositions = new Set<number>();
  for (let i = 0; i < count; i++) {
    const pos = Math.round(((i + 0.5) * total) / count);
    vacantPositions.add(Math.min(pos, total - 1));
  }
  // If collisions reduced the set below `count`, fill remaining from the end.
  let fillIdx = total - 1;
  while (vacantPositions.size < count) {
    if (!vacantPositions.has(fillIdx)) vacantPositions.add(fillIdx);
    fillIdx--;
  }

  const result: DrawSlot[] = [];
  let runnerIdx = 0;
  for (let pos = 0; pos < total; pos++) {
    if (vacantPositions.has(pos)) {
      result.push(null);
    } else {
      // Exactly runners.length non-vacant positions are emitted, so runnerIdx is in range.
      result.push(runners[runnerIdx++]!);
    }
  }
  return result;
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
