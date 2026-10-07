// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Competitor, Event } from '../db/types.ts';
import { withEventStartTimes } from './startTimes.ts';

const runner = (id: string, startTimeMs: number | null) => ({ id, startTimeMs }) as Competitor;
const set = (
  localSeq: number,
  changes: Array<[string, number | null]>,
  competitionId = 'C'
): Event =>
  ({
    nodeId: 'n',
    localSeq,
    competitionId,
    eventType: 'start_times_set',
    eventTimeMs: localSeq,
    recordedAtMs: localSeq,
    payload: {
      event_type: 'start_times_set',
      cause: 'manual',
      class_id: null,
      changes: changes.map(([competitor_id, start_time_ms]) => ({
        competitor_id,
        start_time_ms,
        previous_ms: null,
      })),
    },
  }) as Event;

describe('withEventStartTimes (ADR-0003 update 2026-10)', () => {
  test('the last start_times_set event wins; a runner no event names keeps the stored start', () => {
    const out = withEventStartTimes(
      [runner('a', 1), runner('b', 2), runner('c', 3)],
      [
        set(1, [
          ['a', 10],
          ['b', 20],
        ]),
        set(2, [
          ['a', 11],
          ['b', null],
        ]),
        set(3, [['c', 99]], 'other'),
      ],
      'C'
    );
    assert.deepEqual(
      out.map((c) => [c.id, c.startTimeMs]),
      [
        ['a', 11],
        ['b', null],
        ['c', 3],
      ]
    );
  });
});
