// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DrawError } from './types.ts';
import { drawPursuit } from './pursuit.ts';
import type { PursuitRunner } from './pursuit.ts';

const MIN = 60_000;
const T0 = 1_780_000_000_000;
const R = 1_780_007_200_000; // restart, two hours later
const ok = (id: string, minutes: number): PursuitRunner => ({
  id,
  previousTimeMs: minutes * MIN,
  previousOk: true,
});
const opts = { firstStartMs: T0, restartMs: R, maxBehindMs: 30 * MIN, intervalMs: MIN };
const startOf = (r: { assignments: Array<{ id: string; startTimeMs: number }> }) =>
  Object.fromEntries(r.assignments.map((a) => [a.id, a.startTimeMs]));

describe('drawPursuit (MeOS drawPersuitList, SOFT TR 7.4.1)', () => {
  test('SOFT TR 7.4.1: pursuit — each runner starts their time behind the leader after the first start', () => {
    const r = drawPursuit([ok('b', 42), ok('a', 40), ok('c', 40.5)], { ...opts, reverse: false });
    assert.deepEqual(startOf(r), { a: T0, c: T0 + 30_000, b: T0 + 2 * MIN });
    assert.equal(r.restarted, 0);
  });

  test('SOFT TR 7.4.1: pursuit — too far behind, not OK or no time → restart block in result order', () => {
    const r = drawPursuit(
      [
        ok('lead', 40),
        ok('far', 75),
        ok('farther', 80),
        { id: 'mp', previousTimeMs: 41 * MIN, previousOk: false },
        { id: 'new', previousTimeMs: null, previousOk: false },
      ],
      { ...opts, reverse: false }
    );
    assert.deepEqual(startOf(r), {
      lead: T0,
      far: R,
      farther: R + MIN,
      mp: R + 2 * MIN,
      new: R + 3 * MIN,
    });
    assert.equal(r.restarted, 4);
  });

  test('SOFT TR 7.4.1: reverse pursuit — slowest inside the limit first, leader last, restart block worst first', () => {
    const r = drawPursuit(
      [
        ok('a', 40),
        ok('b', 42),
        ok('c', 50),
        ok('far', 75),
        { id: 'mp', previousTimeMs: null, previousOk: false },
      ],
      {
        ...opts,
        reverse: true,
      }
    );
    assert.deepEqual(startOf(r), { c: T0, b: T0 + 8 * MIN, a: T0 + 10 * MIN, mp: R, far: R + MIN });
    assert.equal(r.restarted, 2);
  });

  test('scale and whole seconds: times are scaled, then rounded to whole seconds (SOFT TR 4.20.7)', () => {
    const r = drawPursuit(
      [ok('a', 40), { id: 'b', previousTimeMs: 40 * MIN + 1_001, previousOk: true }],
      { ...opts, reverse: false, scale: 0.5 }
    );
    assert.deepEqual(startOf(r), { a: T0, b: T0 + 1_000 });
  });

  test('nobody with a time → everyone in the restart block, no crash', () => {
    const r = drawPursuit([{ id: 'x', previousTimeMs: null, previousOk: false }], {
      ...opts,
      reverse: false,
    });
    assert.deepEqual(startOf(r), { x: R });
    assert.deepEqual(drawPursuit([], { ...opts, reverse: true }), {
      assignments: [],
      restarted: 0,
    });
  });

  test('the restart block must come after the last pursuit start', () => {
    const input = [ok('a', 40), ok('b', 50), ok('far', 75)];
    assert.throws(
      () => drawPursuit(input, { ...opts, restartMs: T0 + 5 * MIN, reverse: false }),
      (e: unknown) => e instanceof DrawError && e.code === 'restart_overlaps_pursuit'
    );
    assert.doesNotThrow(() =>
      drawPursuit(input, { ...opts, restartMs: T0 + 10 * MIN + 1, reverse: false })
    );
    // Nobody in the restart block: the restart time does not matter.
    assert.doesNotThrow(() =>
      drawPursuit([ok('a', 40), ok('b', 50)], { ...opts, restartMs: T0, reverse: false })
    );
  });
});
