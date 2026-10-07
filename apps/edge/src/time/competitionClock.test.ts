// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the competition clock: one start-time base
// (epoch ms) and the Europe/Stockholm wall-clock conversions around it.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPETITION_TZ,
  localToEpochMs,
  epochToLocalSeconds,
  formatLocalTime,
} from './competitionClock.ts';

describe('competitionClock', () => {
  test('competition time zone is Europe/Stockholm', () => {
    assert.equal(COMPETITION_TZ, 'Europe/Stockholm');
  });

  test('localToEpochMs: summer date is UTC+2 (CEST)', () => {
    assert.equal(localToEpochMs('2026-10-03', 10 * 3600), Date.parse('2026-10-03T08:00:00Z'));
  });

  test('localToEpochMs: winter date is UTC+1 (CET)', () => {
    assert.equal(localToEpochMs('2026-12-05', 10 * 3600), Date.parse('2026-12-05T09:00:00Z'));
  });

  for (const date of ['2026-07-01', '2026-12-05', '2026-10-25']) {
    test(`round trip epochToLocalSeconds(localToEpochMs(d, s)) === s on ${date}`, () => {
      for (const s of [0, 43199, 43200, 86399]) {
        assert.equal(epochToLocalSeconds(localToEpochMs(date, s)), s, `s=${s}`);
      }
    });
  }

  test('formatLocalTime renders local wall clock as HH:MM:SS', () => {
    assert.equal(formatLocalTime(Date.parse('2026-10-03T08:00:05Z')), '10:00:05');
    assert.equal(formatLocalTime(Date.parse('2026-12-05T22:59:59Z')), '23:59:59');
    assert.equal(formatLocalTime(Date.parse('2026-12-05T23:00:00Z')), '00:00:00');
  });
});
