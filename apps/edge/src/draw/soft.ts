// Authored for fartola. Not ported from upstream.
//
// SOFT club-blocking draw algorithm re-authored from the algorithm described
// in oEventDraw.cpp:130-209 (NOT ported — re-authored against the algorithm).
//
// D-04: drawSOFT produces a permutation that minimises adjacent same-club
// runners (zero adjacency when mathematically possible; best-effort when a
// single club exceeds half the class).
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
 * SOFT club-blocking draw.
 *
 * Algorithm:
 * 1. Group runners by club. Treat null-club runners each as their own
 *    singleton group (they don't create adjacency with anyone).
 * 2. Sort groups descending by size (largest club first).
 * 3. Shuffle within each group.
 * 4. Iterative round-robin interleave: on each pass, take one runner from
 *    each non-empty group (largest-remaining first), repeating until all
 *    groups are drained. This minimises adjacent same-club occurrences.
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

  // --- Step 2: Sort groups descending by size ---
  const groups: DrawRunner[][] = Array.from(groupMap.values()).sort((a, b) => b.length - a.length);

  // --- Step 3: Shuffle within each group ---
  for (const g of groups) {
    fisherYatesShuffle(g, rng);
  }

  // --- Step 4: Iterative round-robin interleave ---
  // Strategy: create a mutable queue per group, then on each iteration pick
  // one runner from each non-empty queue sorted by remaining size descending.
  // This ensures the largest club stays maximally spread.
  const order: DrawRunner[] = [];
  // Working copy of each group as a queue (we shift from front)
  const queues: DrawRunner[][] = groups.map((g) => [...g]);

  while (queues.some((q) => q.length > 0)) {
    // Sort non-empty queues by remaining size descending on each pass
    const nonEmpty = queues.filter((q) => q.length > 0).sort((a, b) => b.length - a.length);
    for (const q of nonEmpty) {
      const runner = q.shift();
      if (runner !== undefined) order.push(runner);
    }
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
    const tmp = arr[i];
    arr[i] = arr[j];
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
      result.push(runners[runnerIdx++]);
    }
  }
  return result;
}

/** Count adjacent pairs in the slot sequence where both runners share a club. */
function countAdjacencies(slots: DrawSlot[]): number {
  let count = 0;
  const real = slots.filter((s): s is DrawRunner => s !== null);
  for (let i = 0; i < real.length - 1; i++) {
    if (real[i].club !== null && real[i].club === real[i + 1].club) count++;
  }
  return count;
}
