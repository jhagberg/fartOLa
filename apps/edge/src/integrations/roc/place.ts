// Authored for fartola. Not ported from upstream.
//
// Places a ROC time of day on the competition clock, the way card times are
// placed (cardClockToWallMs): the latest wall-clock instant with that time of
// day not after the poll time plus the clock-skew tolerance. The ROC date is
// never used, so a sender with a wrong date still lands on the right day.
// This is the only time logic in integrations/roc; the rest works on the
// results.

import type { HalfDayClock } from '@fartola/sportident';
import { cardClockToWallMs, wallMsToEpochMs } from '../../projection/halfDayClockMath.ts';

const HALF_DAY_S = 12 * 3600;

/** 'HH:MM:SS' → seconds since midnight. */
export function timeOfDaySeconds(time: string): number {
  const [h, m, s] = time.split(':').map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
}

/** Wall-clock ms (cardClockToWallMs's scale) and epoch ms for a ROC time of
 * day received at `receivedAtMs`. Any card type but 'SI5' means a 24 h period. */
export function placeTimeOfDay(
  time: string,
  receivedAtMs: number
): { wallMs: number; epochMs: number } {
  const sec = timeOfDaySeconds(time);
  const clock: HalfDayClock = {
    half_day: sec >= HALF_DAY_S ? 1 : 0,
    seconds_in_half_day: sec % HALF_DAY_S,
    weekday: null,
  };
  const wallMs = cardClockToWallMs(clock, 'ROC', receivedAtMs);
  return { wallMs, epochMs: wallMsToEpochMs(wallMs) };
}
