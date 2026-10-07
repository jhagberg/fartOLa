// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fillVacancies, placeBeforeOrAfter, smallestGapMs } from './remaining.ts';
import type { StartedRunner } from './remaining.ts';
import { DrawError } from './types.ts';

const MIN = 60_000;
const T0 = 1_780_000_000_000;
/** Existing start list: clubs by slot, '' = vacant slot. */
function startList(clubs: string[]): StartedRunner[] {
  return clubs.flatMap((c, k) =>
    c === '' ? [] : [{ id: `e${k}`, club: c, startTimeMs: T0 + k * 2 * MIN }]
  );
}
function seq(...values: number[]) {
  let i = 0;
  return (min: number, max: number) => Math.min(max - 1, min + (values[i++ % values.length] ?? 0));
}

describe('late entrants (SOFT TR 7.5.7, TR 7.5.8)', () => {
  test('smallestGapMs: smallest positive gap, null under two distinct times (MeOS drawList)', () => {
    assert.equal(smallestGapMs([T0, T0 + 4 * MIN, T0 + 6 * MIN, T0 + 6 * MIN]), 2 * MIN);
    assert.equal(smallestGapMs([T0, T0]), null);
    assert.equal(smallestGapMs([]), null);
  });

  test('SOFT TR 7.5.8: late entrants before the class (day) — block ends one interval before the first start', () => {
    const existing = startList(['A', 'B', 'A']);
    const late = [
      { id: 'x', club: 'C' },
      { id: 'y', club: 'D' },
    ];
    assert.deepEqual(placeBeforeOrAfter(existing, late, 'Before', 2 * MIN), [
      { id: 'x', startTimeMs: T0 - 4 * MIN },
      { id: 'y', startTimeMs: T0 - 2 * MIN },
    ]);
  });

  test('SOFT TR 7.5.8: late entrants after the class (night) — block starts one interval after the last start', () => {
    const existing = startList(['A', 'B', 'A']);
    const late = [
      { id: 'x', club: 'C' },
      { id: 'y', club: 'D' },
    ];
    assert.deepEqual(placeBeforeOrAfter(existing, late, 'After', 2 * MIN), [
      { id: 'x', startTimeMs: T0 + 6 * MIN },
      { id: 'y', startTimeMs: T0 + 8 * MIN },
    ]);
  });

  test('SOFT TR 7.5.1: the block is reversed when that avoids a same-club neighbour at the seam', () => {
    const existing = startList(['A', 'B', 'C']);
    const after = placeBeforeOrAfter(
      existing,
      [
        { id: 'x', club: 'C' },
        { id: 'y', club: 'D' },
      ],
      'After',
      2 * MIN
    );
    assert.deepEqual(
      after.map((a) => a.id),
      ['y', 'x']
    );
    const before = placeBeforeOrAfter(
      existing,
      [
        { id: 'x', club: 'D' },
        { id: 'y', club: 'A' },
      ],
      'Before',
      2 * MIN
    );
    assert.deepEqual(
      before.map((a) => a.id),
      ['y', 'x']
    );
  });

  test('no start list yet → DrawError no_start_list (MeOS would use 01:00)', () => {
    assert.throws(
      () => placeBeforeOrAfter([], [{ id: 'x', club: null }], 'After', MIN),
      (e: unknown) => e instanceof DrawError && e.code === 'no_start_list'
    );
  });

  test('SOFT TR 7.5.8: late entrants fill vacant places of the grid, never an occupied one', () => {
    const existing = startList(['A', '', 'B', '', 'C']);
    for (let seed = 0; seed < 20; seed++) {
      const got = fillVacancies(
        existing,
        [
          { id: 'x', club: 'D' },
          { id: 'y', club: 'E' },
        ],
        { firstStartMs: T0, intervalMs: 2 * MIN },
        seq(seed % 2, 0)
      );
      assert.deepEqual(
        got.map((a) => a.startTimeMs).sort(),
        [T0 + 2 * MIN, T0 + 6 * MIN],
        `seed ${seed}`
      );
    }
  });

  test('SOFT TR 7.5.1: a vacant place between two starters of the runner’s club is the last choice', () => {
    // Vacant slot 1 sits between A and A; slot 4 between B and C.
    const existing = startList(['A', '', 'A', 'B', '', 'C']);
    for (let seed = 0; seed < 2; seed++) {
      const [got] = fillVacancies(
        existing,
        [{ id: 'x', club: 'A' }],
        { firstStartMs: T0, intervalMs: 2 * MIN },
        seq(seed)
      );
      assert.equal(got!.startTimeMs, T0 + 8 * MIN, `seed ${seed}`);
    }
  });

  test('SOFT TR 7.5.7: more late entrants than vacant places → the rest start right after the last start', () => {
    const got = fillVacancies(
      startList(['A', '', 'B']),
      [
        { id: 'x', club: null },
        { id: 'y', club: null },
        { id: 'z', club: null },
      ],
      { firstStartMs: T0, intervalMs: 2 * MIN },
      seq(0)
    );
    assert.deepEqual(
      got.map((a) => a.startTimeMs),
      [T0 + 2 * MIN, T0 + 6 * MIN, T0 + 8 * MIN]
    );
  });
});
