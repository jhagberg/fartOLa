// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the competition clock: one start-time base
// (epoch ms) and one fixed offset per competition around it.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPETITION_TZ,
  clockToEpochMs,
  competitionClockOffsetMin,
  epochToClockSeconds,
  formatClockTime,
} from './competitionClock.ts';

describe('competitionClock', () => {
  test('competition time zone is Europe/Stockholm', () => {
    assert.equal(COMPETITION_TZ, 'Europe/Stockholm');
  });

  test('the default offset: summer date is UTC+2 (CEST), winter UTC+1 (CET)', () => {
    assert.equal(competitionClockOffsetMin('2026-10-03', null), 120);
    assert.equal(competitionClockOffsetMin('2026-12-05', null), 60);
  });

  for (const [date, offset] of [
    ['2026-07-01', 120],
    ['2026-12-05', 60],
    ['2026-10-25', 60],
  ] as const) {
    test(`round trip epochToClockSeconds(clockToEpochMs(d, s)) === s on ${date}`, () => {
      for (const s of [0, 43199, 43200, 86399]) {
        assert.equal(epochToClockSeconds(clockToEpochMs(date, s, offset), offset), s, `s=${s}`);
      }
    });
  }

  test('formatClockTime renders the competition clock as HH:MM:SS', () => {
    assert.equal(formatClockTime(Date.parse('2026-10-03T08:00:05Z'), 120), '10:00:05');
    assert.equal(formatClockTime(Date.parse('2026-12-05T22:59:59Z'), 60), '23:59:59');
    assert.equal(formatClockTime(Date.parse('2026-12-05T23:00:00Z'), 60), '00:00:00');
  });
});
