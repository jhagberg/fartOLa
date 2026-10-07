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

  test('one group only → DrawError one_seeding_group (MeOS error:invalidmethod)', () => {
    assert.throws(
      () => drawSeeded(seeded(1, ['A', 'B'])),
      (e: unknown) => e instanceof DrawError && e.code === 'one_seeding_group'
    );
  });
});
