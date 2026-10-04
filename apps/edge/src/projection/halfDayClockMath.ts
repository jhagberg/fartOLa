// Authored for fartola. Not ported from upstream.
//
// HalfDayClock → milliseconds conversion + start/finish elapsed time.
// Per codex review C-H2: start/finish on a CardReadEvent are top-level
// HalfDayClock fields (Phase 0 ndjson.ts lines 84-98), NOT punches with
// magic control codes. The reducer reads payload.start + payload.finish and
// computes elapsed via diffMs() — no punch-code branching.
//
// ASSUMPTION (Phase 1): club training courses are < 12h. The midnight wrap
// (start.half_day=1 PM → finish.half_day=0 AM next day) means a real
// ~12-13h crossing event would compute as the SHORT side of the 24h ring,
// which for Phase 1 is correct because no Phase 1 training crosses 12h.
// If Phase 2 introduces multi-day relay legs or rogaining (>12h), this
// helper needs the `weekday` field to disambiguate — Phase 0's
// toHalfDayClock already populates weekday when known.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2
// - packages/sportident/src/output/ndjson.ts lines 71-82 (HalfDayClock +
//   NdjsonPunch component types) + lines 163-180 (toHalfDayClock helper —
//   this file mirrors its 24h-ring semantics for the inverse direction)

import type { HalfDayClock } from '@fartola/sportident';
import { COMPETITION_TZ, epochToLocalSeconds } from '../time/competitionClock.ts';

const HALF_DAY_MS = 12 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Convert a HalfDayClock to absolute ms within a 24h reference. half_day=0
 * (AM) maps to 00:00..11:59:59.999; half_day=1 (PM) maps to
 * 12:00..23:59:59.999. `weekday` is ignored — Phase 1 < 12h assumption
 * makes per-day disambiguation unnecessary.
 */
export function halfDayClockToMs(clock: HalfDayClock): number {
  return clock.half_day * HALF_DAY_MS + clock.seconds_in_half_day * 1000;
}

/**
 * Elapsed-time delta between two HalfDayClock points, in milliseconds.
 *
 * - If either argument is null → returns null (no elapsed time available).
 * - Otherwise computes `(toMs(finish) - toMs(start) + DAY_MS) % DAY_MS`.
 *   The wrap handles a midnight crossing (e.g. start 23:50 PM → finish
 *   00:10 AM next day = 20 minutes, NOT a negative number).
 *
 * Phase 1 < 12h assumption documented in the file header.
 */
export function diffMs(start: HalfDayClock | null, finish: HalfDayClock | null): number | null {
  if (start === null || finish === null) return null;
  const s = halfDayClockToMs(start);
  const f = halfDayClockToMs(finish);
  return (((f - s) % DAY_MS) + DAY_MS) % DAY_MS;
}

/** How far a card time may lie AFTER the read time and still count as "before
 * the read": the station clock can run ahead of the laptop clock. Without it
 * a finish stamped seconds after the host's read time would be placed 24 h
 * (SI5: 12 h) too early. Runs longer than 12 h minus this cannot be resolved
 * on SI5 anyway. */
const CLOCK_SKEW_TOLERANCE_MS = 3600 * 1000;

/** Absolute epoch ms for a card clock. The card time is placed in the 12 h
 * before `readAtMs` when the card cannot say AM/PM (SI5); otherwise
 * half_day is trusted and the date is the one that puts it in the 24 h
 * before readAtMs. Both windows end CLOCK_SKEW_TOLERANCE_MS after readAtMs.
 * Wall-clock arithmetic: a DST switch inside the window shifts the result by
 * the DST hour (only possible for runs across 02:00–03:00 at night). */
export function cardClockToEpochMs(
  clock: HalfDayClock,
  cardType: string,
  readAtMs: number,
  tz: string = COMPETITION_TZ
): number {
  const noPmBit = cardType === 'SI5';
  const period = noPmBit ? HALF_DAY_MS : DAY_MS;
  const cardMs = noPmBit ? clock.seconds_in_half_day * 1000 : halfDayClockToMs(clock);
  const anchor = readAtMs + CLOCK_SKEW_TOLERANCE_MS;
  const anchorLocalMs = Math.round(epochToLocalSeconds(anchor, tz) * 1000);
  const back = (((anchorLocalMs - cardMs) % period) + period) % period;
  return anchor - back;
}
