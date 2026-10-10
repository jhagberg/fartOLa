// Authored for fartola. Not ported from upstream.
//
// GET /api/competitions/:id/speaker against an in-memory database: the
// projection's runners and a stored ROC radio punch end up on the board.
// Synthetic runners and card numbers only.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { SpeakerBoard } from '@fartola/shared-types';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

const COMP = 'comp-1';
const DATE = '2026-10-04';
const START = localToEpochMs(DATE, 10 * 3600);

describe('speaker route', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let nodeId: string;

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId });
    const run = (sql: string, ...args: unknown[]) => handle.sqlite.prepare(sql).run(...args);
    run(
      `INSERT INTO competitions (id, name, date, created_at_ms, roc_controls) VALUES (?, 'C1', ?, 0, '50')`,
      COMP,
      DATE
    );
    run(`INSERT INTO classes (id, competition_id, name) VALUES ('c1', ?, 'H21')`, COMP);
    run(
      `INSERT INTO courses (id, competition_id, name, class_id) VALUES ('k1', ?, 'A', 'c1')`,
      COMP
    );
    [31, 50, 32].forEach((code, i) => {
      run(
        `INSERT INTO controls (id, competition_id, code) VALUES (?, ?, ?)`,
        `ctl${code}`,
        COMP,
        code
      );
      run(
        `INSERT INTO course_controls (id, course_id, control_id, order_idx) VALUES (?, 'k1', ?, ?)`,
        `cc${i}`,
        `ctl${code}`,
        i
      );
    });
    run(
      `INSERT INTO competitors (id, competition_id, name, club, class_id, card_number, start_time_ms, source, consent_status)
       VALUES ('r1', ?, 'Anna Test', 'OK Test', 'c1', 9000001, ?, 'entrylist', 'implicit')`,
      COMP,
      START
    );
  });

  afterEach(async () => {
    await app.close();
    handle.close();
  });

  it('puts a stored radio punch on the board with its place', async () => {
    insertEvent(
      handle,
      nodeId,
      'radio_punch',
      START + 12 * 60_000,
      {
        event_type: 'radio_punch',
        source: 'roc',
        idempotency_key: '2380:1',
        roc_id: 1,
        card_number: 9000001,
        control_code: 50,
        time_of_day: '10:12:00',
        received_at_ms: START + 12 * 60_000 + 5_000,
        roc_date: DATE,
        date_mismatch: false,
      },
      COMP
    );
    const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/speaker` });
    assert.equal(res.statusCode, 200);
    const board = res.json() as SpeakerBoard;
    assert.deepEqual(board.classes[0]!.controls, [50]);
    const r = board.classes[0]!.runners[0]!;
    assert.equal(r.name, 'Anna Test');
    assert.deepEqual(r.passings, [{ elapsed_ms: 12 * 60_000, place: 1, behind_ms: 0 }]);
    assert.equal(board.events[0]!.new_leader, true);
  });

  it('a finish event is at the finish punch, not at the readout', async () => {
    // No drawn start: timed from the start punch, read out a minute later.
    handle.sqlite.prepare(`UPDATE competitors SET start_time_ms = NULL WHERE id = 'r1'`).run();
    const clock = (min: number) => ({
      seconds_in_half_day: 10 * 3600 + min * 60,
      half_day: 0 as const,
      weekday: null,
    });
    insertEvent(
      handle,
      nodeId,
      'race_started',
      START - 60_000,
      { event_type: 'race_started', started_at_ms: START - 60_000 },
      COMP
    );
    insertEvent(
      handle,
      nodeId,
      'card_read',
      START + 31 * 60_000,
      {
        event_type: 'card_read',
        card_number: 9000001,
        card_type: 'SI10',
        start: clock(0),
        finish: clock(30),
        check: null,
        clear: null,
        punch_count: 3,
        punches: [
          { code: 31, ...clock(5) },
          { code: 50, ...clock(12) },
          { code: 32, ...clock(20) },
        ],
        card_holder: null,
      },
      COMP
    );
    const board = (
      await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/speaker` })
    ).json() as SpeakerBoard;
    assert.equal(board.classes[0]!.runners[0]!.finish?.elapsed_ms, 30 * 60_000);
    const fin = board.events.find((e) => e.kind === 'finish')!;
    assert.equal(fin.at_ms, START + 30 * 60_000);
  });

  it('404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/speaker' });
    assert.equal(res.statusCode, 404);
  });
});
