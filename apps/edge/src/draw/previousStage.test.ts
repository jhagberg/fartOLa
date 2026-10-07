// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { matchPreviousStage } from './previousStage.ts';

const MIN = 60_000;

describe('matchPreviousStage (SOFT TR 7.4.1)', () => {
  test('matches by Eventor person id, then by unique name and club; reports the unmatched', () => {
    const current = [
      { id: 'p', name: 'Anna Berg', club: 'OK Ek', eventorPersonId: 7 },
      { id: 'n', name: ' bo dahl ', club: 'IFK', eventorPersonId: null },
      { id: 'twin', name: 'Eva Ek', club: 'OK Ek', eventorPersonId: null },
      { id: 'none', name: 'Ny Person', club: null, eventorPersonId: null },
    ];
    const { matched, unmatched } = matchPreviousStage(current, [
      { name: 'Anna B', club: 'Annan', eventorPersonId: 7, timeMs: 40 * MIN, status: 'OK' },
      {
        name: 'Bo Dahl',
        club: 'ifk',
        eventorPersonId: null,
        timeMs: 41 * MIN,
        status: 'MissingPunch',
      },
      { name: 'Eva Ek', club: 'OK Ek', eventorPersonId: null, timeMs: 42 * MIN, status: 'OK' },
      { name: 'Eva Ek', club: 'OK Ek', eventorPersonId: null, timeMs: 43 * MIN, status: 'OK' },
    ]);
    assert.deepEqual(matched, [
      { id: 'p', timeMs: 40 * MIN, status: 'OK' },
      { id: 'n', timeMs: 41 * MIN, status: 'MissingPunch' },
    ]);
    assert.deepEqual(
      unmatched.map((u) => u.id),
      ['twin', 'none']
    );
  });
});
