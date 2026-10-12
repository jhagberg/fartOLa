// Authored for fartola. Not ported from upstream.
//
// The rule for which race resets an undo takes back (_resetUndo.ts), tested
// on its own: `took` is how many results each outstanding reset took away,
// oldest first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resetsToUndo } from './_resetUndo.ts';

const undoes = (took: number[]): number[] =>
  resetsToUndo(took.map((t, i) => ({ i, took: t }))).map((r) => r.i);

test('resetsToUndo: the latest reset that took results away, and every reset after it', () => {
  const cases: Array<[took: number[], undone: number[]]> = [
    // Nothing outstanding, or only resets after a start by mistake.
    [[], []],
    [[0], []],
    [[0, 0], []],
    // The incident: one reset during a real race.
    [[623], [0]],
    // A second reset that took nothing does not hide the first.
    [
      [623, 0],
      [0, 1],
    ],
    [
      [623, 0, 0],
      [0, 1, 2],
    ],
    // A later reset that took results is the target; the older one waits.
    [[1, 8], [1]],
    [
      [1, 8, 0],
      [1, 2],
    ],
    // A reset after a start by mistake, before the real race, is left alone.
    [[0, 623], [1]],
  ];
  for (const [took, expected] of cases) {
    assert.deepEqual(undoes(took), expected, `took ${JSON.stringify(took)}`);
  }
});
