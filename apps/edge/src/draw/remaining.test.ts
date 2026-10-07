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

  test('SOFT TR 7.5.1/7.5.2: late entrants into vacant places and after the last start → every placement with the fewest neighbours in the whole list, uniformly (chi-square, p = 0.001)', () => {
    // Places: a club letter is a starter ('-' without a club), '' a vacant
    // place. Late entrants: club letters, '-' without a club.
    const pairs = (seq: string[]) => {
      const real = seq.filter((c) => c !== '.');
      return real.reduce((n, c, i) => n + (i > 0 && c !== '-' && c === real[i - 1] ? 1 : 0), 0);
    };
    /** Brute force: every placement with the fewest neighbours, as the
     * club in every place ('.' = empty). */
    const fewestPlacements = (list: string[], late: string[]): string[] => {
      const free = list.flatMap((c, k) => (c === '' ? [k] : []));
      const over = Math.max(0, late.length - free.length);
      const places = [...list.map((c) => (c === '' ? '.' : c)), ...Array<string>(over).fill('.')];
      const slots = [...free, ...Array.from({ length: over }, (_, i) => list.length + i)];
      const left = new Map<string, number>();
      for (const c of late) left.set(c, (left.get(c) ?? 0) + 1);
      let fewest = Number.POSITIVE_INFINITY;
      let out: string[] = [];
      const walk = (i: number, placed: number) => {
        if (i === slots.length) {
          if (placed < late.length) return;
          const n = pairs(places);
          if (n < fewest) [fewest, out] = [n, []];
          if (n === fewest) out.push(places.join(''));
          return;
        }
        if (late.length - placed < slots.length - i && slots[i]! < list.length) walk(i + 1, placed);
        for (const [c, n] of left)
          if (n > 0) {
            left.set(c, n - 1);
            places[slots[i]!] = c;
            walk(i + 1, placed + 1);
            places[slots[i]!] = '.';
            left.set(c, n);
          }
      };
      walk(0, 0);
      return out;
    };
    const cases: Array<[string[], string[]]> = [
      [
        ['B', '', 'C', 'A'],
        ['A', 'B'],
      ], // only B A C A B has no pair
      [
        ['A', '', '', 'A', 'B', '', 'A'],
        ['A', 'A', 'B'],
      ],
      [
        ['', 'A', '', 'B', 'A'],
        ['A', 'B', 'C'],
      ], // a place before the first start, one after
      [
        ['A', '', '', 'B', '', 'A'],
        ['A', 'B'],
      ], // a vacant place stays empty
      [
        ['A', '', 'B', 'A'],
        ['A', 'A', 'B', 'C'],
      ],
      [
        ['A', '', 'A'],
        ['A', 'A'],
      ], // pairs unavoidable
      [
        ['-', '', 'A', '', '-'],
        ['-', 'A', '-'],
      ], // runners without a club
      [
        ['A', 'B', 'A'],
        ['A', 'B', 'A'],
      ], // no vacant place
    ];
    const chiCritical = (df: number) =>
      df * Math.pow(1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df)), 3);
    for (const [list, lateClubs] of cases) {
      const words = fewestPlacements(list, lateClubs);
      const existing: StartedRunner[] = list.flatMap((c, k) =>
        c === '' ? [] : [{ id: `e${k}`, club: c === '-' ? null : c, startTimeMs: T0 + k * 2 * MIN }]
      );
      const late = lateClubs.map((c, i) => ({ id: `l${i}`, club: c === '-' ? null : c }));
      const per = words.length === 2 ? 500 : 100;
      const rng = mulberryRng(4711);
      const seen = new Map<string, number>();
      const what = `${list.map((c) => c || '.').join('')} + ${lateClubs.join('')}`;
      for (let k = 0; k < per * words.length; k++) {
        const got = fillVacancies(
          existing,
          late,
          { firstStartMs: T0, intervalMs: 2 * MIN },
          rng,
          true,
          { onFallback: () => assert.fail(`${what}: not exact`) }
        );
        const places = list.map((c) => (c === '' ? '.' : c));
        for (const a of got)
          places[(a.startTimeMs - T0) / (2 * MIN)] = lateClubs[Number(a.id.slice(1))]!;
        const p = Array.from(
          { length: Math.max(places.length, words[0]!.length) },
          (_, i) => places[i] ?? '.'
        ).join('');
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
      assert.deepEqual(
        [...seen.keys()].sort(),
        [...words].sort(),
        `${what}: every placement, no other`
      );
      if (words.length === 1) continue;
      const chi = words.reduce((x, p) => x + ((seen.get(p) ?? 0) - per) ** 2 / per, 0);
      const critical = chiCritical(words.length - 1);
      assert.ok(chi < critical, `${what}: chi-square ${chi.toFixed(1)} ≥ ${critical.toFixed(1)}`);
    }
    // The open case from review: A takes the place between B and C, B starts last.
    assert.deepEqual(fewestPlacements(['B', '', 'C', 'A'], ['A', 'B']), ['BACAB']);
  });

  test('SOFT TR 7.5.1: vacant places beyond the work budget — exact up to it, then a split, then the preference, the overflow always drawn with its seam', () => {
    // Random classes as measured for PLACE_FEWEST_BUDGET.
    let seed = 7;
    const rnd = (a: number, b: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return a + Math.floor((seed / 2147483648) * (b - a));
    };
    const shape = (n: number, vac: number, lateN: number, clubs: number) => {
      const holes = new Set<number>();
      while (holes.size < vac) holes.add(rnd(1, n + vac - 1));
      const existing: StartedRunner[] = [];
      for (let k = 0; k < n + vac; k++)
        if (!holes.has(k))
          existing.push({ id: `e${k}`, club: `K${rnd(0, clubs)}`, startTimeMs: T0 + k * MIN });
      const late = Array.from({ length: lateN }, (_, i) => ({
        id: `l${i}`,
        club: i % 7 === 0 ? null : `K${rnd(0, clubs)}`,
      }));
      return { existing, late };
    };
    const modeOf = (
      existing: StartedRunner[],
      late: DrawRunner[],
      budget?: number,
      intervalMs = MIN
    ) => {
      let mode = 'exact';
      const got = fillVacancies(
        existing,
        late,
        { firstStartMs: T0, intervalMs },
        mulberryRng(1),
        true,
        {
          ...(budget !== undefined ? { budget } : {}),
          onFallback: (m) => (mode = m),
        }
      );
      assert.equal(
        new Set(got.map((a) => a.startTimeMs)).size,
        late.length,
        'one runner per place'
      );
      return { mode, got };
    };
    const modes = (
      [
        [100, 3, 3, 8],
        [100, 5, 8, 10],
        [100, 20, 10, 10],
        [150, 10, 20, 15],
        [150, 5, 30, 15],
        [150, 20, 30, 15],
      ] as const
    ).map(([n, vac, lateN, clubs]) => {
      const { existing, late } = shape(n, vac, lateN, clubs);
      return `${vac}/${lateN}: ${modeOf(existing, late).mode}`;
    });
    assert.deepEqual(modes, [
      '3/3: exact',
      '5/8: exact',
      '20/10: exact',
      '10/20: exact',
      '5/30: exact',
      '20/30: preference',
    ]);

    // Budget 0: no vacant place → the split (everyone after the last start), drawn with its seam.
    const late = [
      { id: 'a', club: 'A' },
      { id: 'b', club: 'B' },
    ];
    const split = modeOf(startList(['B', 'A']), late, 0, 2 * MIN);
    assert.equal(split.mode, 'split');
    assert.deepEqual(
      split.got.map((a) => a.id),
      ['b', 'a']
    );
    // Budget 0 with a vacant place → the preference rule, every runner placed.
    const pref = modeOf(startList(['B', '', 'C', 'A']), late, 0, 2 * MIN);
    assert.equal(pref.mode, 'preference');
    assert.deepEqual(
      pref.got.map((a) => a.startTimeMs),
      [T0 + 2 * MIN, T0 + 8 * MIN]
    );
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
