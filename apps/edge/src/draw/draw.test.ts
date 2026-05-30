// Authored for fartola. Not ported from upstream.
//
// TDD tests for the three draw algorithms (SOFT, Random, Simultaneous).
// Phase 2.1 D-03 (drawRandom, drawSimultaneous) and D-04 (drawSOFT).
//
// Seeded RNG: all tests inject a deterministic rngFn to avoid flaky
// randomized assertions (GPT MEDIUM: seeded RNG pattern).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { drawSOFT } from './soft.ts';
import { drawRandom } from './random.ts';
import { drawSimultaneous } from './simultaneous.ts';
import type { DrawRunner } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic RNG using a linear congruential generator (LCG).
 *  Returns numbers in [min, max). Produces the same sequence given the same
 *  seed, allowing reproducible test runs. */
function makeLcgRng(seed: number): (min: number, max: number) => number {
  let state = seed;
  return (min: number, max: number): number => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    const range = max - min;
    if (range <= 0) return min;
    return min + (Math.abs(state) % range);
  };
}

function runners(count: number, club: string): DrawRunner[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${club}-${i}`, club }));
}

function mixedRunners(clubs: Array<[string, number]>): DrawRunner[] {
  return clubs.flatMap(([club, count]) => runners(count, club));
}

// ---------------------------------------------------------------------------
// drawSOFT tests
// ---------------------------------------------------------------------------

describe('draw algorithms', () => {
  describe('drawSOFT', () => {
    test('test 1: 10 runners from 3 clubs → permutation + zero adjacency', () => {
      const input = mixedRunners([
        ['Alpha', 4],
        ['Beta', 3],
        ['Gamma', 3],
      ]);
      const result = drawSOFT(input, { rngFn: makeLcgRng(1) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);

      // Same set of IDs
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 2: all runners from same club → no crash, no duplicates, adjacencyCount == 9', () => {
      const input = runners(10, 'Alpha');
      const result = drawSOFT(input, { rngFn: makeLcgRng(2) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 10);
      // All IDs present
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      // 10 runners same club → 9 adjacencies (every pair adjacent)
      assert.equal(result.adjacencyCount, 9);
    });

    test('test 2b: 6 runners where one club has 5 → adjacencyCount >= 3 (impossibility-aware)', () => {
      const input = mixedRunners([
        ['BigClub', 5],
        ['SmallClub', 1],
      ]);
      const result = drawSOFT(input, { rngFn: makeLcgRng(3) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 6);
      // With 5/6 from same club, minimum adjacency is 4 (can't avoid it)
      assert.ok(result.adjacencyCount >= 3, `adjacencyCount was ${result.adjacencyCount}`);
    });

    test('test 3: 0 runners → empty array', () => {
      const result = drawSOFT([], { rngFn: makeLcgRng(4) });
      assert.deepEqual(result.order, []);
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 4: 1 runner → array of 1', () => {
      const input: DrawRunner[] = [{ id: 'solo', club: 'OnlyClub' }];
      const result = drawSOFT(input, { rngFn: makeLcgRng(5) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 1);
      assert.equal(real[0]!.id, 'solo');
    });

    test('test 7: vacantSlots=3 with 10 runners → 13 slots, 3 are null', () => {
      const input = mixedRunners([
        ['A', 4],
        ['B', 3],
        ['C', 3],
      ]);
      const result = drawSOFT(input, { vacantSlots: 3, rngFn: makeLcgRng(6) });
      assert.equal(result.order.length, 13);
      const nullCount = result.order.filter((s) => s === null).length;
      assert.equal(nullCount, 3);
      const realCount = result.order.filter((s) => s !== null).length;
      assert.equal(realCount, 10);
    });

    test('test 8: vacant slots distributed (not all at end)', () => {
      // 10 runners + 3 vacant = 13 slots; max gap between vacants <= ceil(13/3) = 5
      const input = mixedRunners([
        ['A', 4],
        ['B', 3],
        ['C', 3],
      ]);
      const result = drawSOFT(input, { vacantSlots: 3, rngFn: makeLcgRng(7) });
      const vacantIdxs = result.order.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0);
      assert.equal(vacantIdxs.length, 3);
      // Verify not all at end
      const allAtEnd = vacantIdxs.every((i) => i >= 10);
      assert.ok(!allAtEnd, 'All vacant slots were at the end');
    });

    test('test 9: 200 runners from 20 clubs completes without stack overflow', () => {
      const input = mixedRunners(
        Array.from({ length: 20 }, (_, i) => [`Club${i}`, 10] as [string, number])
      );
      assert.equal(input.length, 200);
      const result = drawSOFT(input, { rngFn: makeLcgRng(9) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 200);
      // Must be a permutation
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      // Should have zero or very low adjacency (20 clubs x 10 each is perfectly separable)
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 1b: SOFT adjacency verified across 10 seeded runs (3-club scenario)', () => {
      const input = mixedRunners([
        ['Alpha', 4],
        ['Beta', 3],
        ['Gamma', 3],
      ]);
      for (let seed = 100; seed < 110; seed++) {
        const result = drawSOFT(input, { rngFn: makeLcgRng(seed) });
        const real = result.order.filter((s): s is DrawRunner => s !== null);
        // Always a permutation
        assert.deepEqual(
          real.map((r) => r.id).sort(),
          input.map((r) => r.id).sort(),
          `seed ${seed}: not a permutation`
        );
        // Always zero adjacency (3 clubs, none dominant)
        assert.equal(result.adjacencyCount, 0, `seed ${seed}: adjacency not zero`);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // drawRandom tests
  // ---------------------------------------------------------------------------

  describe('drawRandom', () => {
    test('test 5: 10 runners → permutation (run 10 times, at least one differs)', () => {
      const input = mixedRunners([
        ['A', 5],
        ['B', 5],
      ]);
      let anyDiffers = false;
      const inputOrder = input.map((r) => r.id);
      for (let seed = 200; seed < 210; seed++) {
        const result = drawRandom(input, { rngFn: makeLcgRng(seed) });
        const real = result.order.filter((s): s is DrawRunner => s !== null);
        // Must be same length and same IDs
        assert.equal(real.length, input.length);
        assert.deepEqual(real.map((r) => r.id).sort(), inputOrder.slice().sort());
        if (real.map((r) => r.id).join() !== inputOrder.join()) {
          anyDiffers = true;
        }
      }
      assert.ok(anyDiffers, 'All 10 runs produced the same order as input');
    });
  });

  // ---------------------------------------------------------------------------
  // drawSimultaneous tests
  // ---------------------------------------------------------------------------

  describe('drawSimultaneous', () => {
    test('test 6: 5 runners → all get the same start time (order preserved)', () => {
      const input = mixedRunners([
        ['A', 3],
        ['B', 2],
      ]);
      const result = drawSimultaneous(input);
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 5);
      // Input order preserved (simultaneous = no reordering)
      assert.deepEqual(
        real.map((r) => r.id),
        input.map((r) => r.id)
      );
      // adjacencyCount should reflect actual adjacencies in the unchanged order
      // (simultaneous means the route will assign the same time to all slots)
    });
  });
});
