// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { drawSeeded } from './seeded.ts';
import type { SeededRunner } from './seeded.ts';
import { DrawError } from './types.ts';
import type { DrawRunner } from './types.ts';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return (min: number, max: number): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
  };
}
const seeded = (group: number | null, clubs: string[]): SeededRunner[] =>
  clubs.map((club, i) => ({ id: `${group ?? 'u'}-${i}-${club}`, club, seedGroup: group }));

describe('drawSeeded (MeOS oClass::drawSeeded, SOFT TR 7.4.5)', () => {
  test('SOFT TR 7.4.5: each seeding group is drawn within itself, strongest group last', () => {
    const input = [
      ...seeded(1, ['A', 'B', 'C']),
      ...seeded(2, ['A', 'B', 'D', 'E']),
      ...seeded(null, ['F', 'G']),
    ];
    for (let seed = 1; seed <= 50; seed++) {
      const order = drawSeeded(input, { rngFn: mulberry(seed) }).order.filter(
        (s): s is DrawRunner => s !== null
      );
      const groupOf = (r: DrawRunner) => input.find((x) => x.id === r.id)!.seedGroup;
      assert.deepEqual(order.map(groupOf), [null, null, 2, 2, 2, 2, 1, 1, 1], `seed ${seed}`);
    }
  });

  test('bestFirst: strongest group starts first', () => {
    const input = [...seeded(1, ['A', 'B']), ...seeded(2, ['C', 'D'])];
    const order = drawSeeded(input, { bestFirst: true, rngFn: mulberry(3) })
      .order as SeededRunner[];
    assert.deepEqual(
      order.map((r) => input.find((x) => x.id === r.id)!.seedGroup),
      [1, 1, 2, 2]
    );
  });

  test('SOFT TR 7.5.1: no same-club neighbours inside a group or at the seam when avoidable', () => {
    const input = [...seeded(1, ['A', 'B', 'A']), ...seeded(2, ['A', 'C', 'A', 'D'])];
    for (let seed = 1; seed <= 50; seed++)
      assert.equal(drawSeeded(input, { rngFn: mulberry(seed) }).adjacencyCount, 0, `seed ${seed}`);
  });

  /** Brute force: every club pattern of the groups in this order (each
   * group's runners in any order, '-' = no club) with the fewest same-club
   * neighbours, seams between groups counted. */
  const fewestGrouped = (groups: string[][]): string[] => {
    let fewest = Number.POSITIVE_INFINITY;
    let words: string[] = [];
    const walk = (g: number, left: string[], s: string, cost: number): void => {
      if (cost > fewest) return;
      if (left.length === 0) {
        if (g + 1 === groups.length) {
          if (cost < fewest) [fewest, words] = [cost, []];
          words.push(s);
          return;
        }
        return walk(g + 1, [...groups[g + 1]!], s, cost);
      }
      for (const c of new Set(left)) {
        const rest = [...left];
        rest.splice(rest.indexOf(c), 1);
        const last = s.at(-1);
        walk(g, rest, s + c, cost + (c !== '-' && c === last ? 1 : 0));
      }
    };
    walk(0, [...groups[0]!], '', 0);
    return words;
  };

  test('SOFT TR 7.5.1/7.5.2: seeded draw → every order with the fewest neighbours, seams between groups counted, uniformly (chi-square, p = 0.001)', () => {
    const chiCritical = (df: number) =>
      df * Math.pow(1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df)), 3);
    const shapes: string[][][] = [
      Array.from({ length: 12 }, () => ['A', 'B']), // 4096 orders, 2 without a pair
      [['A'], ['A', 'A', 'B']], // BAA (1 pair inside) ties with ABA (1 at the seam)
      [
        ['A', 'A', 'B'],
        ['A', 'B'],
        ['A', 'C'],
      ],
      [
        ['A', 'A', 'B', 'B'],
        ['A', 'B', 'C'],
      ],
      [
        ['A', 'B', 'C'],
        ['A', 'B', 'C'],
        ['A', 'B', 'C'],
      ],
      [
        ['A', 'A', 'A'],
        ['A', 'B'],
      ], // pairs unavoidable
      [
        ['A', '-'],
        ['A', 'B', '-'],
      ], // runners without a club
    ];
    for (const groups of shapes) {
      const words = fewestGrouped(groups);
      const per = words.length === 2 ? 500 : 100;
      const N = per * words.length;
      const input = groups.flatMap((clubs, g) =>
        clubs.map((club, i) => ({
          id: `${g}-${i}`,
          club: club === '-' ? null : club,
          seedGroup: g + 1,
        }))
      );
      const rng = mulberry(4711);
      const seen = new Map<string, number>();
      for (let k = 0; k < N; k++) {
        const order = drawSeeded(input, { bestFirst: true, rngFn: rng }).order as DrawRunner[];
        const p = order.map((r) => r.club ?? '-').join('');
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
      const shape = groups.map((g) => g.join('')).join('|');
      assert.deepEqual(
        [...seen.keys()].sort(),
        [...words].sort(),
        `${shape}: every order, no other`
      );
      if (words.length === 1) continue;
      const chi = words.reduce((x, p) => x + ((seen.get(p) ?? 0) - per) ** 2 / per, 0);
      const critical = chiCritical(words.length - 1);
      assert.ok(chi < critical, `${shape}: chi-square ${chi.toFixed(1)} ≥ ${critical.toFixed(1)}`);
    }
  });

  test('one group only → DrawError one_seeding_group (MeOS error:invalidmethod)', () => {
    assert.throws(
      () => drawSeeded(seeded(1, ['A', 'B'])),
      (e: unknown) => e instanceof DrawError && e.code === 'one_seeding_group'
    );
  });
});
