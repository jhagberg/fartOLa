// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Competitor, Event } from '../db/types.ts';
import { startMarkers, withEventStartTimes } from './startTimes.ts';

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

describe('startMarkers (todo start-list markers)', () => {
  const ev = (
    localSeq: number,
    cause: string,
    changes: Array<[string, number | null]>,
    extra: Record<string, unknown> = {}
  ): Event =>
    ({
      ...set(localSeq, changes),
      payload: { ...(set(localSeq, changes).payload as object), cause, ...extra },
    }) as Event;
  const undo = (localSeq: number, of: number, changes: Array<[string, number | null]>) =>
    ev(localSeq, 'undo', changes, { undoes: { node_id: 'n', local_seq: of } });
  const markers = (events: Event[]) => Object.fromEntries(startMarkers(events, 'C'));

  test('a hand edit or a missing start is "new_time"; a late entrant "late_entrant"', () => {
    assert.deepEqual(
      markers([
        ev(1, 'draw', [
          ['a', 10],
          ['b', 20],
          ['c', 30],
        ]),
        ev(2, 'manual', [['a', 15]]),
        ev(3, 'missing_starts', [['b', 25]]),
        ev(4, 'late_entrants', [['d', 40]]),
      ]),
      { a: 'new_time', b: 'new_time', d: 'late_entrant' }
    );
  });

  test('a pursuit runner at or after the restart block is "restart"', () => {
    assert.deepEqual(
      markers([
        ev(
          1,
          'draw',
          [
            ['a', 10],
            ['b', 50],
            ['c', 60],
          ],
          { restart_ms: 50 }
        ),
      ]),
      { b: 'restart', c: 'restart' }
    );
  });

  test('a redraw clears the markers; a clock shift keeps them', () => {
    const edit = ev(2, 'manual', [['a', 15]]);
    assert.deepEqual(
      markers([ev(1, 'draw', [['a', 10]]), edit, ev(3, 'clock_shift', [['a', 75]])]),
      {
        a: 'new_time',
      }
    );
    assert.deepEqual(markers([ev(1, 'draw', [['a', 10]]), edit, ev(3, 'draw', [['a', 30]])]), {});
  });

  test('undo gives back the marker before; undoing the undo gives it again', () => {
    const events = [ev(1, 'late_entrants', [['a', 40]]), ev(2, 'manual', [['a', 45]])];
    assert.deepEqual(markers([...events, undo(3, 2, [['a', 40]])]), { a: 'late_entrant' });
    assert.deepEqual(markers([...events, undo(3, 2, [['a', 40]]), undo(4, 3, [['a', 45]])]), {
      a: 'new_time',
    });
  });
});
