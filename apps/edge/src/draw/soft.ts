// Authored for fartola. Not ported from upstream.
//
// SOFT club-separating draw. Written for fartOLa (c684d95), not from MeOS:
// MeOS's drawSOFTMethod (MeOS code/oEventDraw.cpp:130-209) leaves avoidable
// same-club neighbours and repeats few club patterns (draw benchmark,
// apps/edge/scripts/draw-benchmark.ts), so it fails SOFT TR 7.5.1/7.5.2
// (ADR-0011).
//
// D-04: drawSOFT draws uniformly among the start orders with the fewest
// same-club neighbours possible: zero when no club exceeds half the class,
// else 2·M − n − 1 (SOFT TR 7.5.1). Every such order is equally likely
// (TR 7.5.2), counted exactly below. With a boundary (late entrants,
// remaining.ts) the neighbours at the seams to the existing start list
// count too.
//
// D-06: Vakanta startplatser are distributed as null-competitor gaps in the
// draw order, in random gaps (vacancies.ts).
//
// Phase 2.1 D-03/D-04.

import crypto from 'node:crypto';
import type { DrawRunner, DrawResult, DrawSlot, RngFn, VacantPosition } from './types.ts';
import { placeVacancies } from './vacancies.ts';

/** Clubs of the starters right before and after the drawn block. */
export interface DrawBoundary {
  before?: string | null;
  after?: string | null;
}

/** Options for drawSOFT. */
export interface DrawSOFTOptions {
  /** Number of vacant (null) slots to insert. Defaults to 0. */
  vacantSlots?: number;
  /** Where the vacant slots go (default 'Mixed', see vacancies.ts). */
  vacantPosition?: VacantPosition;
  /** Fixed starters around the block (late entrants): a same-club pair at
   * a seam counts as a neighbour. `adjacencyCount` still counts inside the
   * returned order only. */
  boundary?: DrawBoundary;
  /**
   * Optional RNG injection for reproducible tests.
   * Signature: (min: number, max: number) => number (returns integer in [min, max)).
   * Defaults to crypto.randomInt (CSPRNG).
   */
  rngFn?: RngFn;
}

/**
 * SOFT club-separating draw (SOFT TR 7.5.1 (2026-07-01): runners from the
 * same club "ska om möjligt inte starta direkt efter varandra"; TR 7.5.2:
 * all outcomes random).
 *
 * Runners are grouped by club; a runner without a club is a club of one.
 * The draw picks a club pattern (the start order's sequence of clubs)
 * uniformly among the patterns with the fewest same-club neighbours
 * (samplePattern), then shuffles each club's runners into its places. Every
 * pattern holds the same number of start orders, so every start order with
 * the fewest neighbours is equally likely. Vacant null slots go in last
 * (vacancies.ts).
 */
export function drawSOFT(runners: DrawRunner[], opts: DrawSOFTOptions = {}): DrawResult {
  const rng = opts.rngFn ?? ((min, max) => crypto.randomInt(min, max));
  if (runners.length === 0) return { order: [], adjacencyCount: 0 };

  // null-club runners each become a singleton group with a unique key so they
  // never merge with each other or count as "same club" adjacency.
  const groupMap = new Map<string, DrawRunner[]>();
  for (const r of runners) {
    const key = r.club !== null ? r.club : `__null_${r.id}`;
    const existing = groupMap.get(key);
    if (existing) existing.push(r);
    else groupMap.set(key, [r]);
  }
  const keys = [...groupMap.keys()];
  const groups = [...groupMap.values()];
  for (const g of groups) fisherYatesShuffle(g, rng);
  const indexOf = (club: string | null | undefined) => (club == null ? -1 : keys.indexOf(club));

  const pattern = samplePattern(
    groups.map((g) => g.length),
    indexOf(opts.boundary?.before),
    indexOf(opts.boundary?.after),
    rng
  );
  const order = pattern.map((c) => groups[c]!.pop()!);
  const result = placeVacancies(order, opts.vacantSlots ?? 0, opts.vacantPosition ?? 'Mixed', rng);
  return { order: result, adjacencyCount: countAdjacencies(result) };
}

// ---------------------------------------------------------------------------
// Uniform minimum-neighbour club patterns
// ---------------------------------------------------------------------------
//
// A pattern is a word over clubs 0..K−1 with counts[c] letters of club c,
// optionally between a fixed letter `before` and a fixed letter `after`.
// Its cost is the number of equal neighbours, the fixed letters included.
//
// Counting. Build the word by inserting one club at a time (largest first,
// for speed; any order counts the same). Inserting club x with c letters
// into the current word: split them into s runs (C(c−1, s−1) ordered
// compositions) and put the runs, left to right, into s distinct gaps of
// the word. A run of length g adds g − 1 pairs; its gap adds
//   −1 if it lies between two equal letters (the pair is broken),
//   +1 if it touches a fixed letter of club x (+1 also for the gap between
//      `before` and `after` when both are x: one pair broken, two made),
//    0 otherwise.
// Deleting club x from a word gives back the word before x, x's runs and
// their gaps, so every word comes from exactly one sequence of choices.
// N[t][d] = number of words over the first t inserted clubs with d pairs,
//   N[t+1][d + c − s − j + a] += N[t][d] · C(c−1, s−1) · C(minus, j)
//                                · C(plus, a) · C(zero, s − j − a),
// where the word before step t has `minus` = d gaps worth −1, `plus` (0–2)
// worth +1 and `zero` the rest.
//
// Sampling. d* = the smallest d with N[K][d] > 0 (the fewest neighbours).
// Walk back from (K, d*): pick the step (d', s, j, a) into (t+1, d) with
// probability N[t][d'] · ways / N[t+1][d]. Then rebuild the word forward,
// choosing the composition and the j, a and s − j − a gaps uniformly.
// A word's probability is the product of N[t][d_t] / N[t+1][d_{t+1}] over
// its steps, which telescopes to 1/N[K][d*]: exactly uniform, given a
// uniform rng. Exact BigInt counts; random BigInts by rejection.
//
// Limits. N has about K·n entries; a step costs (d values) · c · min(c, d)
// · (plus+1) BigInt products, n·Σc² overall at worst. That is polynomial
// in the class size whatever the clubs, so there is no state budget and no
// fallback chain. Measured (Node 26, median draw, draw-benchmark.ts): 200
// runners in a few big and many small clubs 9 ms, 10 clubs × 20 18 ms,
// 20 clubs × 15 (300 runners) 42 ms, one club of 150 + 50 0.1 ms; the
// worst case is many big clubs, 50 clubs × 20 (1000 runners) 1.4 s.

/** Rows of Pascal's triangle as BigInts, grown on demand. */
const pascal: bigint[][] = [[1n]];
function binom(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  while (pascal.length <= n) {
    const prev = pascal[pascal.length - 1]!;
    const row = [1n];
    for (let i = 1; i < prev.length; i++) row.push(prev[i - 1]! + prev[i]!);
    row.push(1n);
    pascal.push(row);
  }
  return pascal[n]![k]!;
}

interface Table {
  /** Clubs with runners, in insertion order. */
  order: number[];
  /** counts[order[t]]. */
  sizes: number[];
  /** N[t][d]. */
  layers: bigint[][];
  /** Gaps a run may go into before step t. */
  gaps: number[];
  /** Club of the fixed letter before / after the word, -1 for none. */
  before: number;
  after: number;
  fewest: number;
}

/** Gap classes before inserting club order[t] into a word with d pairs. */
function gapClasses(tb: Table, t: number, d: number) {
  const x = tb.order[t]!;
  const plus = (tb.before === x ? 1 : 0) + (tb.after === x ? 1 : 0);
  // Step 0 between before and after, both x: the single gap is bad and
  // touches two x letters, net +1.
  if (t === 0 && plus === 2) return { minus: 0, plus: 1, zero: 0 };
  return { minus: d, plus, zero: tb.gaps[t]! - d - plus };
}

function buildTable(counts: readonly number[], before: number, after: number): Table {
  // A fixed letter of a club with no runners here can never be a neighbour.
  const has = (c: number) => c >= 0 && (counts[c] ?? 0) > 0;
  const b = has(before) ? before : -1;
  const a = has(after) ? after : -1;
  const ends = (b >= 0 ? 1 : 0) + (a >= 0 ? 1 : 0);
  const order = counts
    .map((_, i) => i)
    .filter((i) => counts[i]! > 0)
    .sort((x, y) => counts[y]! - counts[x]! || x - y);
  const d0 = b >= 0 && b === a ? 1 : 0;
  const first = new Array<bigint>(d0 + 1).fill(0n);
  first[d0] = 1n;
  const tb: Table = {
    order,
    sizes: order.map((i) => counts[i]!),
    layers: [first],
    gaps: [],
    before: b,
    after: a,
    fewest: 0,
  };
  let m = ends;
  for (let t = 0; t < order.length; t++) {
    const c = tb.sizes[t]!;
    tb.gaps.push(m + 1 - ends);
    const prev = tb.layers[t]!;
    const next = new Array<bigint>(prev.length + c + 2).fill(0n);
    for (let d = 0; d < prev.length; d++) {
      const w = prev[d]!;
      if (w === 0n) continue;
      const { minus, plus, zero } = gapClasses(tb, t, d);
      for (let s = 1; s <= c; s++) {
        const ws = w * binom(c - 1, s - 1);
        for (let pa = 0; pa <= Math.min(plus, s); pa++) {
          const wa = ws * binom(plus, pa);
          for (let j = 0; j <= Math.min(minus, s - pa); j++) {
            const z = binom(zero, s - j - pa);
            if (z === 0n) continue;
            const k = d + c - s - j + pa;
            next[k] = next[k]! + wa * binom(minus, j) * z;
          }
        }
      }
    }
    tb.layers.push(next);
    m += c;
  }
  tb.fewest = tb.layers[order.length]!.findIndex((v) => v > 0n);
  return tb;
}

/** The fewest neighbours possible for clubs of these sizes (seams to the
 * clubs `before` / `after` included, indexes, -1 for none) and the number of
 * club patterns that reach it. */
export function fewestPatterns(
  counts: readonly number[],
  before = -1,
  after = -1
): { fewest: number; count: bigint } {
  const tb = buildTable(counts, before, after);
  return { fewest: tb.fewest, count: tb.layers[tb.order.length]![tb.fewest]! };
}

/** Uniform random BigInt in [0, n), n > 0. */
function randomBelow(n: bigint, rng: RngFn): bigint {
  if (n <= 0x1_0000_0000n) return BigInt(rng(0, Number(n)));
  const bits = n.toString(2).length;
  for (;;) {
    let r = 0n;
    for (let left = bits; left > 0; left -= 32) {
      const take = Math.min(32, left);
      r = (r << BigInt(take)) | BigInt(rng(0, 2 ** take));
    }
    if (r < n) return r;
  }
}

/** k distinct elements of `items`, uniformly (partial Fisher-Yates). */
function pick<T>(items: readonly T[], k: number, rng: RngFn): T[] {
  const a = [...items];
  for (let i = 0; i < k; i++) {
    const j = rng(i, a.length);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, k);
}

/**
 * A club pattern drawn uniformly among those with the fewest same-club
 * neighbours: counts[c] letters of club c, seams to the clubs `before` and
 * `after` (indexes, -1 for none) counted. Returns the club of each place.
 */
export function samplePattern(
  counts: readonly number[],
  before: number,
  after: number,
  rng: RngFn
): number[] {
  const tb = buildTable(counts, before, after);
  const K = tb.order.length;

  // Walk back from (K, fewest), choosing each step by its share of the count.
  const steps: Array<{ s: number; j: number; a: number; d: number }> = new Array(K);
  let d = tb.fewest;
  for (let t = K - 1; t >= 0; t--) {
    const c = tb.sizes[t]!;
    const prev = tb.layers[t]!;
    let r = randomBelow(tb.layers[t + 1]![d]!, rng);
    search: for (let s = 1; s <= c; s++)
      for (let a = 0; a <= 2; a++)
        for (let j = 0; j <= s - a; j++) {
          const dp = d - (c - s) + j - a;
          if (dp < 0 || dp >= prev.length || prev[dp] === 0n) continue;
          const g = gapClasses(tb, t, dp);
          const w =
            prev[dp]! *
            binom(c - 1, s - 1) *
            binom(g.minus, j) *
            binom(g.plus, a) *
            binom(g.zero, s - j - a);
          if (r < w) {
            steps[t] = { s, j, a, d: dp };
            break search;
          }
          r -= w;
        }
    // r < N[t+1][d], the sum of these weights, so a step was chosen.
    d = steps[t]!.d;
  }

  // Rebuild forward with uniform compositions and gap sets.
  const lo = tb.before >= 0 ? 1 : 0;
  const hi = tb.after >= 0 ? 1 : 0;
  let word: number[] = [...(lo ? [tb.before] : []), ...(hi ? [tb.after] : [])];
  for (let t = 0; t < K; t++) {
    const x = tb.order[t]!;
    const c = tb.sizes[t]!;
    const { s, j, a } = steps[t]!;
    const byDelta: number[][] = [[], [], []]; // gaps worth −1, 0, +1
    for (let p = lo; p <= word.length - hi; p++) {
      const left = word[p - 1];
      const right = word[p];
      const delta =
        (left === x ? 1 : 0) +
        (right === x ? 1 : 0) -
        (left !== undefined && left === right ? 1 : 0);
      byDelta[delta + 1]!.push(p);
    }
    const gaps = [
      ...pick(byDelta[0]!, j, rng),
      ...pick(byDelta[1]!, s - j - a, rng),
      ...pick(byDelta[2]!, a, rng),
    ].sort((p, q) => p - q);
    const cuts = pick(
      Array.from({ length: c - 1 }, (_, i) => i + 1),
      s - 1,
      rng
    ).sort((p, q) => p - q);
    const runs = [...cuts, c].map((cut, i) => cut - (i > 0 ? cuts[i - 1]! : 0));
    const next: number[] = [];
    let g = 0;
    for (let p = 0; p <= word.length; p++) {
      if (gaps[g] === p) for (let i = runs[g++]!; i > 0; i--) next.push(x);
      if (p < word.length) next.push(word[p]!);
    }
    word = next;
  }
  return word.slice(lo, word.length - hi);
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
export function countAdjacencies(slots: DrawSlot[]): number {
  let count = 0;
  const real = slots.filter((s): s is DrawRunner => s !== null);
  for (let i = 0; i < real.length - 1; i++) {
    // The loop stops before the last element, so i and i + 1 are in range.
    if (real[i]!.club !== null && real[i]!.club === real[i + 1]!.club) count++;
  }
  return count;
}
