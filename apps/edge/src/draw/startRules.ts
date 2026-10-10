// Authored for fartola. Not ported from upstream.
//
// SOFT start rule that reads the competition's distance (TA till TR
// 7.4.4). The start-order rule (TR 7.4.2) is freeStartForbidden in
// projection/preRaceCheck.ts.

import type { CompetitionDistance } from '@fartola/shared-types';

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
