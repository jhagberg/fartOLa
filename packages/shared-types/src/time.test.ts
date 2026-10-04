// Authored for fartola. Not ported from upstream.
//
// Wall clock ↔ epoch across the Europe/Stockholm DST switches of 2026.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { epochToWallClockMs, wallClockToEpochMs } from './time.ts';

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
