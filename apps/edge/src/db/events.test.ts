// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the events table append-only invariant
// (REQ-EVT-002, ADR-0003) and the (node_id, local_seq) primary key
// (REQ-EVT-001 / REQ-EVT-003). The append-only triggers come from the
// hand-authored 0001_append_only_triggers.sql migration — tests 2, 3,
// and 6 are the C-H1 regression gate that proves the 0001 migration
// applied alongside 0000 on cold start.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H1
// - docs/decisions/0003-event-sourcing-as-core-data-model.md

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { openDatabase } from './index.ts';
import { nextLocalSeq } from './seq.ts';

interface TriggerRow {
  name: string;
}

interface EventRow {
  node_id: string;
  local_seq: number;
  competition_id: string | null;
  event_type: string;
  event_time_ms: number;
  recorded_at_ms: number;
  payload: string;
}

const NODE_ID = 'node-events-test';

function insertEvent(
  sqlite: ReturnType<typeof openDatabase>['sqlite'],
  localSeq: number,
  eventType = 'connection_changed'
): void {
  const payload = JSON.stringify({ event_type: eventType, state: 'open' });
  sqlite
    .prepare(
      'INSERT INTO events (node_id, local_seq, competition_id, event_type, event_time_ms, recorded_at_ms, payload) VALUES (?, ?, NULL, ?, ?, ?, ?)'
    )
    .run(NODE_ID, localSeq, eventType, 1_000, 1_001, payload);
}

describe('events: append-only invariant', () => {
  test('test 1: insert + round-trip via SELECT', () => {
    const handle = openDatabase(':memory:');
    try {
      insertEvent(handle.sqlite, 1);
      const row = handle.sqlite
        .prepare<unknown[], EventRow>('SELECT * FROM events WHERE node_id=? AND local_seq=?')
        .get(NODE_ID, 1);
      assert.ok(row);
      assert.equal(row.event_type, 'connection_changed');
      // payload is stored as TEXT JSON; JSON.parse round-trips it.
      const parsed = JSON.parse(row.payload) as { event_type: string; state: string };
      assert.equal(parsed.event_type, 'connection_changed');
      assert.equal(parsed.state, 'open');
    } finally {
      handle.close();
    }
  });

  test('test 2 (C-H1): UPDATE events is rejected by the trigger', () => {
    const handle = openDatabase(':memory:');
    try {
      insertEvent(handle.sqlite, 1);
      assert.throws(() => {
        handle.sqlite
          .prepare('UPDATE events SET event_time_ms = 0 WHERE node_id=? AND local_seq=?')
          .run(NODE_ID, 1);
      }, /events table is append-only/);
    } finally {
      handle.close();
    }
  });

  test('test 3 (C-H1): DELETE events is rejected by the trigger', () => {
    const handle = openDatabase(':memory:');
    try {
      insertEvent(handle.sqlite, 1);
      assert.throws(() => {
        handle.sqlite.prepare('DELETE FROM events WHERE node_id=? AND local_seq=?').run(NODE_ID, 1);
      }, /events table is append-only/);
    } finally {
      handle.close();
    }
  });

  test('test 4: duplicate (node_id, local_seq) fails PRIMARY KEY constraint', () => {
    const handle = openDatabase(':memory:');
    try {
      insertEvent(handle.sqlite, 1);
      assert.throws(
        () => insertEvent(handle.sqlite, 1),
        /UNIQUE constraint failed: events\.node_id, events\.local_seq/
      );
    } finally {
      handle.close();
    }
  });

  test('test 5: nextLocalSeq returns 1 on empty, max+1 with rows', () => {
    const handle = openDatabase(':memory:');
    try {
      const freshNodeId = `fresh-${crypto.randomUUID()}`;
      assert.equal(nextLocalSeq(handle, freshNodeId), 1);
      insertEvent(handle.sqlite, 1);
      assert.equal(nextLocalSeq(handle, NODE_ID), 2);
      insertEvent(handle.sqlite, 2, 'card_inserted');
      assert.equal(nextLocalSeq(handle, NODE_ID), 3);
    } finally {
      handle.close();
    }
  });

  test('test 6 (C-H1 query gate): both append-only triggers present after cold start', () => {
    const handle = openDatabase(':memory:');
    try {
      const triggers = handle.sqlite
        .prepare<unknown[], TriggerRow>(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('events_no_update', 'events_no_delete') ORDER BY name"
        )
        .all();
      assert.equal(
        triggers.length,
        2,
        `expected 2 triggers, got ${triggers.length}: ${JSON.stringify(triggers)}`
      );
      assert.deepEqual(
        triggers.map((t) => t.name),
        ['events_no_delete', 'events_no_update']
      );
    } finally {
      handle.close();
    }
  });
});
