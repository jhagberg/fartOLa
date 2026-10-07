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
// TR 7.5.6). Each group is drawn with drawSOFT instead of MeOS's permute +
// "noClubNb" pass (:4813-4869): that pass can move a runner into the next
// group, and SOFT TR 7.5.1 draws "inom respektive seedningsgrupp". Where two
// groups meet, a same-club pair is avoided by drawing again.

import { countAdjacencies, drawSOFT } from './soft.ts';
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

  // Draw every group; a same-club pair where two groups meet is avoided by
  // drawing again (up to 100 times), keeping the draw with fewest pairs.
  // Rejection keeps every acceptable outcome equally likely (TR 7.5.2).
  let best: DrawRunner[] = [];
  let bestPairs = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 100 && bestPairs > 0; attempt++) {
    const groups = values.map((v) =>
      drawSOFT(
        runners.filter((r) => value(r) === v).map(({ id, club }) => ({ id, club })),
        { rngFn: rng }
      ).order.filter((s): s is DrawRunner => s !== null)
    );
    if (!opts.bestFirst) groups.reverse();
    const flat = groups.flat();
    const pairs = countAdjacencies(flat);
    if (pairs < bestPairs) [best, bestPairs] = [flat, pairs];
  }

  const order = placeVacancies(best, opts.vacantSlots ?? 0, opts.vacantPosition ?? 'Mixed', rng);
  return { order, adjacencyCount: countAdjacencies(order) };
}
