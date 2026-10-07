// Authored for fartola. Not ported from upstream.
//
// node:test coverage for halfDayClockToMs + diffMs. Covers the eight
// scenarios from plan 01-07 task 1 verify gate, including:
//   - simple AM/PM mapping (tests 1-3)
//   - same-half-day deltas (test 4)
//   - cross-half-day boundary deltas (test 5)
//   - midnight-wrap deltas (test 6)
//   - null pass-through (test 7)
//   - identity delta (test 8)
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { HalfDayClock } from '@fartola/sportident';
import { halfDayClockToMs, diffMs, cardClockToEpochMs } from './halfDayClockMath.ts';
import { clockToEpochMs } from '../time/competitionClock.ts';

/** Build a HalfDayClock from a "seconds since the day's midnight" scalar.
 * Wraps modulo 24h so the helper is safe for values >= 24h. */
function hd(totalSeconds: number): HalfDayClock {
  const wrapped = ((totalSeconds % (24 * 3600)) + 24 * 3600) % (24 * 3600);
  return {
    seconds_in_half_day: wrapped % (12 * 3600),
    half_day: wrapped < 12 * 3600 ? 0 : 1,
    weekday: null,
  };
}

describe('halfDayClockToMs', () => {
  test('test 1: midnight (00:00) → 0 ms', () => {
    assert.equal(halfDayClockToMs(hd(0)), 0);
  });

  test('test 2: noon (12:00) → 12 * 3600 * 1000', () => {
    assert.equal(halfDayClockToMs(hd(12 * 3600)), 12 * 3600 * 1000);
  });

  test('test 3: 00:30 → 30 * 60 * 1000', () => {
    assert.equal(halfDayClockToMs(hd(30 * 60)), 30 * 60 * 1000);
  });
});

describe('diffMs', () => {
  test('test 4: AM 10:00 → AM 10:30 = 30 min', () => {
    const start = hd(10 * 3600);
    const finish = hd(10 * 3600 + 30 * 60);
    assert.equal(diffMs(start, finish), 30 * 60 * 1000);
  });

  test('test 5: AM 11:50 → PM 12:10 = 20 min (across AM/PM boundary)', () => {
    const start = hd(11 * 3600 + 50 * 60);
    const finish = hd(12 * 3600 + 10 * 60);
    assert.equal(diffMs(start, finish), 20 * 60 * 1000);
  });

  test('test 6: PM 23:50 → AM 00:10 = 20 min (across midnight wrap)', () => {
    // start at 23:50 = PM, s_in_hd = 11h50m, half_day=1
    const start: HalfDayClock = {
      seconds_in_half_day: 11 * 3600 + 50 * 60,
      half_day: 1,
      weekday: null,
    };
    // finish at 00:10 next day = AM, s_in_hd = 10m, half_day=0
    const finish: HalfDayClock = {
      seconds_in_half_day: 10 * 60,
      half_day: 0,
      weekday: null,
    };
    assert.equal(diffMs(start, finish), 20 * 60 * 1000);
  });

  test('test 7: null pass-through in either position → null', () => {
    const c: HalfDayClock = { seconds_in_half_day: 0, half_day: 0, weekday: null };
    assert.equal(diffMs(null, c), null);
    assert.equal(diffMs(c, null), null);
    assert.equal(diffMs(null, null), null);
  });

  test('test 8: same clock → 0', () => {
    const c = hd(7 * 3600 + 15 * 60);
    assert.equal(diffMs(c, c), 0);
  });
});

// Card clocks on the competition clock (one fixed offset), anchored on the
// read time — like MeOS, no DST arithmetic.
describe('cardClockToEpochMs', () => {
  const DAY = '2026-10-03';
  const OFFSET = 120; // CEST, the default for DAY
  /** The epoch ms for `sec` after midnight on `day`'s competition clock. */
  const at = (sec: number, day = DAY): number => clockToEpochMs(day, sec, OFFSET);
  const place = (clock: HalfDayClock, card: string, read: number): number =>
    cardClockToEpochMs(clock, card, read, OFFSET);
  /** Raw card clock as an SI5 stores it: seconds in the half day, no PM bit. */
  const si5 = (sec: number): HalfDayClock => ({
    seconds_in_half_day: sec % (12 * 3600),
    half_day: 0,
    weekday: null,
  });

  test('SIAC punches 11:58 (AM) and 12:03 (PM) are 5 min apart', () => {
    const read = at(12 * 3600 + 10 * 60);
    const am = place(hd(11 * 3600 + 58 * 60), 'SIAC', read);
    const pm = place(hd(12 * 3600 + 3 * 60), 'SIAC', read);
    assert.equal(am, at(11 * 3600 + 58 * 60));
    assert.equal(pm - am, 5 * 60 * 1000);
  });

  test('SI5 start 11:50 + finish 00:20 (half_day 0) read at 12:25 → 30 min', () => {
    const read = at(12 * 3600 + 25 * 60);
    const start = place(si5(11 * 3600 + 50 * 60), 'SI5', read);
    const finish = place(si5(20 * 60), 'SI5', read);
    assert.equal(start, at(11 * 3600 + 50 * 60));
    assert.equal(finish - start, 30 * 60 * 1000);
  });

  test('PM card time read after midnight lands on the previous day', () => {
    const read = at(15 * 60, '2026-10-04');
    assert.equal(place(hd(23 * 3600 + 50 * 60), 'SIAC', read), at(23 * 3600 + 50 * 60));
  });

  test('midnight: 23:50 → 00:10 read at 00:15 is 20 min', () => {
    const read = at(15 * 60, '2026-10-04');
    const run = place(hd(10 * 60), 'SIAC', read) - place(hd(23 * 3600 + 50 * 60), 'SIAC', read);
    assert.equal(run, 20 * 60 * 1000);
  });

  test('a finish stamped slightly after the read time (station clock ahead) is not a day early', () => {
    const read = at(10 * 3600);
    assert.equal(place(hd(10 * 3600 + 30), 'SIAC', read), at(10 * 3600 + 30));
    assert.equal(place(si5(10 * 3600 + 30), 'SI5', read), at(10 * 3600 + 30));
  });

  test('the read time itself places as the read time', () => {
    const read = at(13 * 3600);
    assert.equal(place(hd(13 * 3600), 'SIAC', read), read);
  });
});

// SI stations don't switch DST and the card has no date or time zone: the
// times on the card are what count (MeOS oEvent::convertTimes). A DST night
// only matters through the read time, which anchors the date; the fixed
// offset gives every card time exactly one instant.
describe('cardClockToEpochMs on DST nights (Europe/Stockholm)', () => {
  const utc = (iso: string): number => Date.parse(iso);
  const clk = (h: number, m: number): HalfDayClock => hd(h * 3600 + m * 60);
  const run = (
    start: HalfDayClock,
    finish: HalfDayClock,
    read: number,
    offset: number,
    card = 'SIAC'
  ): number =>
    cardClockToEpochMs(finish, card, read, offset) - cardClockToEpochMs(start, card, read, offset);

  test('2026-10-25: station clock 02:50 → 03:10, read 03:15 CET → 20 min', () => {
    assert.equal(run(clk(2, 50), clk(3, 10), utc('2026-10-25T02:15:00Z'), 60), 20 * 60 * 1000);
  });

  test('2026-10-25: 02:50 in the repeated hour is one instant (+01:00)', () => {
    const read = utc('2026-10-25T02:15:00Z');
    assert.equal(cardClockToEpochMs(clk(2, 50), 'SIAC', read, 60), utc('2026-10-25T01:50:00Z'));
  });

  test('2026-03-29: station clock 01:50 → 03:10, read 03:20 CEST → 80 min', () => {
    assert.equal(run(clk(1, 50), clk(3, 10), utc('2026-03-29T01:20:00Z'), 120), 80 * 60 * 1000);
  });

  test('2026-03-29 on SI5 (no PM bit): same run → 80 min', () => {
    const read = utc('2026-03-29T01:20:00Z');
    assert.equal(run(clk(1, 50), clk(3, 10), read, 120, 'SI5'), 80 * 60 * 1000);
  });

  test('2026-10-25 (25 h day): a 12:00 punch read at 10:30 is the day before', () => {
    // 12:00 is after the read (+ skew), so it is yesterday's 12:00 at +01:00.
    const read = utc('2026-10-25T09:30:00Z'); // 10:30 CET
    assert.equal(cardClockToEpochMs(clk(12, 0), 'SIAC', read, 60), utc('2026-10-24T11:00:00Z'));
  });
});
