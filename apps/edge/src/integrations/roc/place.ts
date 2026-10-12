// Authored for fartola. Not ported from upstream.
//
// Places a ROC time of day on the competition clock the way card times are
// placed (cardClockToEpochMs): the latest instant with that time of day not
// after the receive time plus the clock-skew tolerance, on the competition's
// one fixed offset (ADR-0017). The ROC date is never used, so a sender with a
// wrong date still lands on the right day. This is the only time logic in
// integrations/roc; everything else is epoch ms.

import type { HalfDayClock } from '@fartola/sportident';
import type { EventPayload } from '../../db/schema.ts';
import { cardClockToEpochMs } from '../../projection/halfDayClockMath.ts';

const HALF_DAY_S = 12 * 3600;

/** 'HH:MM:SS' → seconds since midnight. */
export function timeOfDaySeconds(time: string): number {
  const [h, m, s] = time.split(':').map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
}

/** Epoch ms of a ROC time of day received at `receivedAtMs`, on the
 * competition clock `offsetMin`. Any card type but 'SI5' means a 24 h period. */
export function placeTimeOfDay(time: string, receivedAtMs: number, offsetMin: number): number {
  const sec = timeOfDaySeconds(time);
  const clock: HalfDayClock = {
    half_day: sec >= HALF_DAY_S ? 1 : 0,
    seconds_in_half_day: sec % HALF_DAY_S,
    weekday: null,
  };
  return cardClockToEpochMs(clock, 'ROC', receivedAtMs, offsetMin);
}

/** Epoch ms of a stored radio punch: its time of day placed as above, plus
 * the 1/256 s a serial record carries (ROC rows have whole seconds). Every
 * reader of radio punches places them with this, so they agree. */
export function placeRadioPunch(
  p: Extract<EventPayload, { event_type: 'radio_punch' }>,
  offsetMin: number
): number {
  const ms = placeTimeOfDay(p.time_of_day, p.received_at_ms, offsetMin);
  return p.source === 'serial' ? ms + Math.round((p.subsec_256 * 1000) / 256) : ms;
}
