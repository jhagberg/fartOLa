// Authored for fartola. Not ported from upstream.
//
// SOFT start rules that read the competition's distance and level and the
// class kind (TR 7.4.2–7.4.4).

import type {
  ClassKind,
  ClassKindSource,
  CompetitionDistance,
  CompetitionLevel,
} from '@fartola/shared-types';

import { kindConfirmed, kindNeedsAge } from './classKind.ts';

/** SOFT TA till TR 7.4.4: the normal start interval per distance (sprint
 * one minute, medel and natt two, lång three). Ultralång distance is
 * normally a mass start, and an unset distance has no norm: null. */
export function normalIntervalSec(distance: CompetitionDistance | null): number | null {
  switch (distance) {
    case 'sprint':
      return 60;
    case 'medel':
    case 'natt':
      return 120;
    case 'lang':
      return 180;
    default:
      return null;
  }
}

/** SOFT TR 7.4.2: "Fri starttid får inte tillämpas i åldersklasser vid
 * tävling inom nivåerna 1–3." True for a confirmed age class at nivå 1–3,
 * false when the rule does not apply, null while the kind is unconfirmed
 * or the level unset. */
export function freeStartBanned(
  cls: { classKind: ClassKind | null; classKindSource: ClassKindSource | null },
  level: CompetitionLevel | null
): boolean | null {
  if (level === null || !kindConfirmed(cls)) return null;
  const nationalLevel = level === 'niva1' || level === 'niva2' || level === 'niva3';
  return nationalLevel && kindNeedsAge(cls.classKind!);
}
