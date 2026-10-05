// Authored for fartola. Not ported from upstream.
//
// Wall clock ↔ epoch across the Europe/Stockholm DST switches of 2026.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  epochToWallClockMs,
  formatWallClock,
  parseTimeOfDay,
  parseWallClock,
  startBeforeFinishWallMs,
  wallClockToEpochMs,
} from './time.ts';

const wall = (iso: string): number => Date.parse(`${iso}Z`); // local wall time on the UTC scale
const utc = (iso: string): number => Date.parse(iso);

describe('wallClockToEpochMs (Europe/Stockholm)', () => {
  test('an ordinary wall time is one instant', () => {
    assert.deepEqual(wallClockToEpochMs(wall('2026-06-01T12:00:00')), [
      utc('2026-06-01T10:00:00Z'),
    ]);
  });

  test('02:30 on 2026-10-25 happens twice: CEST, then CET', () => {
    assert.deepEqual(wallClockToEpochMs(wall('2026-10-25T02:30:00')), [
      utc('2026-10-25T00:30:00Z'),
      utc('2026-10-25T01:30:00Z'),
    ]);
  });

  test('02:30 on 2026-03-29 never happens: read with the CET offset', () => {
    assert.deepEqual(wallClockToEpochMs(wall('2026-03-29T02:30:00')), [
      utc('2026-03-29T01:30:00Z'),
    ]);
  });

  test('epochToWallClockMs is the inverse on both sides of a switch', () => {
    for (const iso of ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z']) {
      assert.ok(wallClockToEpochMs(epochToWallClockMs(utc(iso))).includes(utc(iso)), iso);
    }
  });
});

describe('formatWallClock / parseWallClock', () => {
  test('a wall time in the skipped spring hour round-trips', () => {
    const ms = wall('2026-03-29T02:00:54');
    assert.equal(formatWallClock(ms), '2026-03-29T02:00:54');
    assert.equal(parseWallClock('2026-03-29T02:00:54'), ms);
  });

  test('sub-second wall times keep their milliseconds', () => {
    const ms = wall('2026-03-29T02:00:54.5');
    assert.equal(formatWallClock(ms), '2026-03-29T02:00:54.500');
    assert.equal(parseWallClock('2026-03-29T02:00:54.500'), ms);
    assert.equal(parseWallClock('2026-03-29T02:00:54.5'), ms);
  });

  test('anything else is null', () => {
    for (const text of [
      '2026-03-29 02:00:54',
      '2026-03-29T02:00',
      '2026-03-29T02:00:54Z',
      '2026-03-29T02:00:54+01:00',
      '2026-02-30T10:00:00',
      '2026-03-29T24:00:00',
      '2026-03-29T10:60:00',
      '',
    ]) {
      assert.equal(parseWallClock(text), null, text);
    }
  });
});

describe('parseTimeOfDay', () => {
  test('HH:MM and HH:MM:SS → seconds after midnight', () => {
    assert.equal(parseTimeOfDay('10:21:40'), 10 * 3600 + 21 * 60 + 40);
    assert.equal(parseTimeOfDay(' 9:05 '), 9 * 3600 + 5 * 60);
    assert.equal(parseTimeOfDay('00:00'), 0);
  });

  test('anything else is null', () => {
    for (const text of ['24:00', '10:60', '10:00:60', '1000', 'abc', '', '10:5']) {
      assert.equal(parseTimeOfDay(text), null, text);
    }
  });
});

// Codex third review of #51, finding 4: a start entered as a time of day is
// placed on the finish's wall-clock timeline, before the finish.
describe('startBeforeFinishWallMs', () => {
  test('same day, on the DST days too: 01:50 → 03:10 is 80 minutes', () => {
    for (const day of ['2026-03-29', '2026-10-25']) {
      const finish = wall(`${day}T03:10:00`);
      const start = startBeforeFinishWallMs(parseTimeOfDay('01:50')!, finish)!;
      assert.equal(formatWallClock(start), `${day}T01:50:00`);
      assert.equal(finish - start, 80 * 60_000);
    }
  });

  test('03:00 against a finish at 03:10 on the DST days is 03:00', () => {
    for (const day of ['2026-03-29', '2026-10-25']) {
      const start = startBeforeFinishWallMs(parseTimeOfDay('03:00')!, wall(`${day}T03:10:00`))!;
      assert.equal(formatWallClock(start), `${day}T03:00:00`);
    }
  });

  test('23:50 against a finish at 00:10 is the day before: 20 minutes', () => {
    const finish = wall('2026-10-04T00:10:00');
    const start = startBeforeFinishWallMs(parseTimeOfDay('23:50')!, finish)!;
    assert.equal(formatWallClock(start), '2026-10-03T23:50:00');
    assert.equal(finish - start, 20 * 60_000);
  });

  test('a start after the finish is null', () => {
    assert.equal(
      startBeforeFinishWallMs(parseTimeOfDay('10:30')!, wall('2026-10-03T10:00:00')),
      null
    );
  });

  test('a start at the finish is a zero run', () => {
    const finish = wall('2026-10-03T10:00:00');
    assert.equal(startBeforeFinishWallMs(parseTimeOfDay('10:00')!, finish), finish);
  });
});
