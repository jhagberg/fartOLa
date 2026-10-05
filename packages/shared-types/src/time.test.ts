// Authored for fartola. Not ported from upstream.
//
// Wall clock ↔ epoch across the Europe/Stockholm DST switches of 2026.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { epochToWallClockMs, formatWallClock, parseWallClock, wallClockToEpochMs } from './time.ts';

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
