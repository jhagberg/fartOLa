// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fillVacancies, placeBeforeOrAfter, seamClubs, smallestGapMs } from './remaining.ts';
import { drawSOFT } from './soft.ts';
import type { StartedRunner } from './remaining.ts';
import { DrawError } from './types.ts';
import type { DrawRunner } from './types.ts';

const MIN = 60_000;
const T0 = 1_780_000_000_000;
/** Existing start list: clubs by slot, '' = vacant slot. */
function startList(clubs: string[]): StartedRunner[] {
  return clubs.flatMap((c, k) =>
    c === '' ? [] : [{ id: `e${k}`, club: c, startTimeMs: T0 + k * 2 * MIN }]
  );
}
function mulberryRng(seed: number) {
  let a = seed >>> 0;
  return (min: number, max: number): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
  };
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

  test('seamClubs: the block meets the first start (Before) or the last start (After)', () => {
    const existing = startList(['B', 'C', 'A']);
    assert.deepEqual(seamClubs(existing, 'Before'), { after: 'B' });
    assert.deepEqual(seamClubs(existing, 'After'), { before: 'A' });
    assert.deepEqual(seamClubs([], 'After'), {});
  });

  test('SOFT TR 7.5.1/7.5.2: the late block is drawn with its seam club → no same-club neighbour in the block or at the seam, every such order drawn', () => {
    // Both ends of the block would be A: reversing alone cannot help.
    const late = ['A', 'B', 'C', 'B', 'A'].map((club, i) => ({ id: `l${i}`, club }));
    const byId = new Map(late.map((r) => [r.id, r.club]));
    for (const placement of ['Before', 'After'] as const) {
      const existing =
        placement === 'Before' ? startList(['A', 'B', 'C']) : startList(['B', 'C', 'A']);
      const rng = mulberryRng(7);
      const seen = new Set<string>();
      for (let k = 0; k < 400; k++) {
        const { order } = drawSOFT(late, { boundary: seamClubs(existing, placement), rngFn: rng });
        const got = placeBeforeOrAfter(existing, order as DrawRunner[], placement, 2 * MIN);
        const clubs = got.map((a) => byId.get(a.id)!).join('');
        const all = placement === 'Before' ? `${clubs}A` : `A${clubs}`;
        assert.doesNotMatch(all, /(.)\1/, `${placement}: ${all}`);
        seen.add(clubs);
      }
      // 12 orders of AABBC have no equal neighbours; 7 of them keep A off
      // the seam (5 start with A, 5 end with A).
      assert.equal(seen.size, 7, `${placement}: ${[...seen].join(' ')}`);
    }
  });

  test('SOFT TR 7.5.1: late entrants beyond the vacant places start after the last start without a same-club neighbour at the seam', () => {
    // Last start A, no vacant place: A then B would give A–A.
    const existing = startList(['B', 'A']);
    const late = [
      { id: 'a', club: 'A' },
      { id: 'b', club: 'B' },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const got = fillVacancies(
        existing,
        late,
        { firstStartMs: T0, intervalMs: 2 * MIN },
        mulberryRng(seed),
        true
      );
      assert.deepEqual(got, [
        { id: 'b', startTimeMs: T0 + 4 * MIN },
        { id: 'a', startTimeMs: T0 + 6 * MIN },
      ]);
    }
  });

  test('SOFT TR 7.5.8: a hand-edited off-grid start occupies its place; a late entrant never lands before it', () => {
    const existing: StartedRunner[] = [
      { id: 'a', club: 'A', startTimeMs: T0 + 30_000 },
      { id: 'b', club: 'B', startTimeMs: T0 + 2 * MIN },
    ];
    for (let seed = 0; seed < 10; seed++) {
      const [got] = fillVacancies(
        existing,
        [{ id: 'x', club: 'C' }],
        { firstStartMs: T0, intervalMs: MIN },
        seq(seed % 2)
      );
      assert.equal(got!.startTimeMs, T0 + MIN, `seed ${seed}`);
    }
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
