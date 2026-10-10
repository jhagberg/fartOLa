// Authored for fartola. Not ported from upstream.
//
// node:test coverage for cardPunchCapacity: each card series at its edges,
// SI-Card6* inside the SI-Card8 series, null for unknown numbers, and the
// SI-Card5's 30 timed punches.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardPunchCapacity } from './cardCapacity.ts';

test('card series edges give the published punch capacity', () => {
  const cases: Array<[number, number | null]> = [
    [999, null],
    [1_000, 36], // SI-Card5
    [499_999, 36],
    [500_000, 64], // SI-Card6
    [999_999, 64],
    [1_000_000, 50], // SI-Card9
    [1_999_999, 50],
    [2_000_000, 30], // SI-Card8
    [2_002_999, 30],
    [2_003_000, 64], // SI-Card6*
    [2_003_999, 64],
    [2_004_000, 30],
    [2_999_999, 30],
    [3_000_000, null],
    [4_000_000, 20], // SI-pCard
    [6_000_000, null], // tCard: not known
    [7_000_000, 128], // SI-Card10
    [8_000_000, 128], // SIAC
    [9_999_999, 128], // SI-Card11
    [10_000_000, null],
  ];
  for (const [card, want] of cases) {
    assert.equal(cardPunchCapacity(card)?.punches ?? null, want, `card ${card}`);
  }
});

test('only an SI-Card5 stores fewer punches with time than it holds', () => {
  assert.deepEqual(cardPunchCapacity(12_345), { punches: 36, timed: 30 });
  assert.deepEqual(cardPunchCapacity(2_000_000), { punches: 30, timed: 30 });
  assert.deepEqual(cardPunchCapacity(8_000_000), { punches: 128, timed: 128 });
});
