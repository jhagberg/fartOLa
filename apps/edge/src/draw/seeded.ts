// Ported from MeOS code/oClass.cpp (melinsoftware/meos, GPL-3.0-or-later).
// Copyright (C) Melin Software HB and contributors. Modified for fartOLa 2026-10-07.
//
// Seeded draw (seedningsgrupper, SOFT TR 7.4.5, TR 7.5.1). From
// oClass::drawSeeded (oClass.cpp:4737-4880):
// - runners sorted by seed value; equal values stay in one group
//   (:4767, :4796-4809);
// - all values equal → refused, seeding would change nothing (:4769-4771);
// - each group drawn on its own, groups in seed order; by default the
//   order is reversed so the strongest group starts last (:4871-4872).
// Modified: the seed value is the organiser's stored group number
// (competitors.seed_group, 1 = strongest) because fartOLa has no ranking;
// runners in no group form the last group, as unranked runners do (TA till
// TR 7.5.6). The groups are drawn with fartOLa's own sampleGrouped (below)
// instead of MeOS's permute + "noClubNb" pass (:4813-4869): that pass can
// move a runner into the next group, and SOFT TR 7.5.1 draws "inom
// respektive seedningsgrupp". The whole order is drawn uniformly among the
// orders with the fewest same-club neighbours, the seams between groups
// counted (TR 7.5.1, TR 7.5.2).

import { countAdjacencies, patternCounts, randomBelow, samplePattern } from './soft.ts';
import type { DrawResult, DrawRunner, RngFn, VacantPosition } from './types.ts';
import { DrawError } from './types.ts';
import { placeVacancies } from './vacancies.ts';
import crypto from 'node:crypto';

export interface SeededRunner extends DrawRunner {
  /** 1 = strongest group; null = in no group (drawn as the last group). */
  seedGroup: number | null;
}

export interface DrawSeededOptions {
  /** Strongest group first (MeOS reverseOrder). Default false: strongest last. */
  bestFirst?: boolean;
  vacantSlots?: number;
  vacantPosition?: VacantPosition;
  rngFn?: RngFn;
}

export function drawSeeded(
  runners: readonly SeededRunner[],
  opts: DrawSeededOptions = {}
): DrawResult {
  const rng = opts.rngFn ?? ((min, max) => crypto.randomInt(min, max));
  const value = (r: SeededRunner) => r.seedGroup ?? Number.POSITIVE_INFINITY;
  const values = [...new Set(runners.map(value))].sort((a, b) => a - b);
  if (values.length < 2)
    throw new DrawError(
      'one_seeding_group',
      'All runners are in one seeding group; use an ordinary draw.'
    );

  const groups = values.map((v) => runners.filter((r) => value(r) === v));
  if (!opts.bestFirst) groups.reverse();
  // Clubs by index over the whole class; a runner without a club is a club
  // of one. Each group's runners of a club are shuffled into its places.
  const keyOf = (r: DrawRunner) => r.club ?? `__null_${r.id}`;
  const keys = [...new Set(runners.map(keyOf))];
  const index = new Map(keys.map((k, i) => [k, i]));
  const byClub = groups.map((g) => {
    const lists = keys.map((): DrawRunner[] => []);
    for (const r of g) lists[index.get(keyOf(r))!]!.push({ id: r.id, club: r.club });
    for (const l of lists)
      for (let i = l.length - 1; i > 0; i--) {
        const j = rng(0, i + 1);
        [l[i], l[j]] = [l[j]!, l[i]!];
      }
    return lists;
  });
  const patterns = sampleGrouped(
    byClub.map((lists) => lists.map((l) => l.length)),
    rng
  );
  const best = patterns.flatMap((p, g) => p.map((c) => byClub[g]![c]!.pop()!));

  const order = placeVacancies(best, opts.vacantSlots ?? 0, opts.vacantPosition ?? 'Mixed', rng);
  return { order, adjacencyCount: countAdjacencies(order) };
}

/**
 * Club patterns for groups that start in this order, each group's runners
 * in any order: uniform among the combinations with the fewest same-club
 * neighbours, the seams between groups counted (SOFT TR 7.5.1, TR 7.5.2).
 * counts[g][c] = runners of club c in group g.
 *
 * Own algorithm. A group's pattern is a word w followed by its last club e,
 * so after a group ending in club L its neighbours d are those of w between
 * the fixed clubs L and e: patternCounts(counts − e, L, e)[d] (soft.ts).
 * F[g][e][D] = combinations of the first g groups ending in club e with D
 * neighbours in all, summed over L and d. Walk back from the fewest D,
 * choosing (L, d) in proportion to F[g−1][L][D − d] · count, then draw each
 * group's w with exactly d neighbours (samplePattern). A combination's
 * probability telescopes to 1/(number of fewest combinations), as in
 * soft.ts. Cost: per group, one pattern table (soft.ts) per distinct
 * (size of L's club, size of e's club, L = e) in the group, and the
 * neighbour totals stop at Σ fewest per group + seams.
 */
export function sampleGrouped(counts: readonly (readonly number[])[], rng: RngFn): number[][] {
  // A club the group does not have never meets its first runner.
  const seam = (g: number, L: number) => (L >= 0 && counts[g]![L]! > 0 ? L : -1);
  const without = (g: number, e: number) => counts[g]!.map((n, c) => (c === e ? n - 1 : n));
  // No combination needs more neighbours than each group at its fewest
  // (max(0, 2·M − n − 1)) plus one at every seam; larger D are dropped.
  const cap = counts.reduce((x, at) => {
    const n = at.reduce((a, b) => a + b, 0);
    return x + Math.max(0, 2 * Math.max(...at) - n - 1);
  }, counts.length - 1);
  // Group g's patterns ending in e after a group ending in L, by d. The
  // count only depends on the sizes of L's and e's clubs in the group and
  // whether L is e (relabelling clubs changes nothing), so that is the key.
  const cache = new Map<string, bigint[]>();
  const table = (g: number, L: number, e: number): bigint[] => {
    const l = seam(g, L);
    const k = `${g}:${l < 0 ? -1 : counts[g]![l]}:${counts[g]![e]}:${l === e}`;
    let t = cache.get(k);
    if (t === undefined) {
      t = patternCounts(without(g, e), l, e).slice(0, cap + 1);
      cache.set(k, t);
    }
    return t;
  };
  const at = (dist: readonly bigint[], i: number) => dist[i] ?? 0n;

  const F: Array<Map<number, bigint[]>> = [new Map([[-1, [1n]]])];
  for (let g = 0; g < counts.length; g++) {
    const next = new Map<number, bigint[]>();
    for (const [L, dist] of F[g]!)
      for (let e = 0; e < counts[g]!.length; e++) {
        if (counts[g]![e] === 0) continue;
        const t = table(g, L, e);
        const out = next.get(e) ?? [];
        for (let D = 0; D < dist.length; D++)
          for (let d = 0; d < t.length && D + d <= cap; d++)
            if (dist[D]! > 0n && t[d]! > 0n) out[D + d] = at(out, D + d) + dist[D]! * t[d]!;
        next.set(e, out);
      }
    F.push(next);
  }

  const choose = <T>(options: ReadonlyArray<readonly [T, bigint]>): T => {
    let r = randomBelow(
      options.reduce((x, [, w]) => x + w, 0n),
      rng
    );
    for (const [o, w] of options) {
      if (r < w) return o;
      r -= w;
    }
    throw new Error('unreachable: r is below the total');
  };
  // The fewest neighbours in all, then the last club, then back group by group.
  const end = [...F[counts.length]!];
  let D = 0;
  while (!end.some(([, dist]) => at(dist, D) > 0n)) D++;
  let e = choose(end.map(([club, dist]) => [club, at(dist, D)] as const));
  const picks: Array<{ L: number; e: number; d: number }> = new Array(counts.length);
  for (let g = counts.length - 1; g >= 0; g--) {
    const options: Array<readonly [{ L: number; d: number }, bigint]> = [];
    for (const [L, dist] of F[g]!) {
      const t = table(g, L, e);
      for (let d = 0; d <= D && d < t.length; d++)
        options.push([{ L, d }, at(dist, D - d) * t[d]!]);
    }
    const { L, d } = choose(options);
    picks[g] = { L, e, d };
    D -= d;
    e = L;
  }
  return picks.map(({ L, e, d }, g) => [...samplePattern(without(g, e), seam(g, L), e, rng, d), e]);
}
