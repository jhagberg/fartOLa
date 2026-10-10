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

  const MIN = 60_000;
  const clock = (min: number) => ({
    seconds_in_half_day: 10 * 3600 + min * 60,
    half_day: 0 as const,
    weekday: null,
  });
  const ev = (type: string, atMs: number, payload: Record<string, unknown>) =>
    insertEvent(
      handle,
      nodeId,
      type as never,
      atMs,
      { event_type: type, ...payload } as never,
      COMP
    );
  const radioAt = (code: number, min: number) =>
    ev('radio_punch', START + min * MIN, {
      source: 'roc',
      idempotency_key: `2380:${code}:${min}`,
      roc_id: 1,
      card_number: 9000001,
      control_code: code,
      time_of_day: `10:${String(min).padStart(2, '0')}:00`,
      received_at_ms: START + min * MIN + 5_000,
      roc_date: DATE,
      date_mismatch: false,
    });
  /** Race started, then a read: start and finish punch at these minutes past 10. */
  const readOut = (startMin: number, finishMin: number) => {
    ev('race_started', START - MIN, { started_at_ms: START - MIN });
    ev('card_read', START + (finishMin + 1) * MIN, {
      card_number: 9000001,
      card_type: 'SI10',
      start: clock(startMin),
      finish: clock(finishMin),
      check: null,
      clear: null,
      punch_count: 3,
      punches: [
        { code: 31, ...clock(startMin + 3) },
        { code: 50, ...clock(startMin + 10) },
        { code: 32, ...clock(startMin + 15) },
      ],
      card_holder: null,
    });
  };
  const getBoard = async () =>
    (
      await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/speaker` })
    ).json() as SpeakerBoard;

  it('puts a stored radio punch on the board with its place', async () => {
    radioAt(50, 12);
    const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/speaker` });
    assert.equal(res.statusCode, 200);
    const board = res.json() as SpeakerBoard;
    assert.deepEqual(board.classes[0]!.controls, [50]);
    assert.equal(board.clock_offset_min, 120); // CEST on 2026-10-04
    const r = board.classes[0]!.runners[0]!;
    assert.equal(r.name, 'Anna Test');
    assert.deepEqual(r.passings, [{ elapsed_ms: 12 * MIN, place: 1, behind_ms: 0 }]);
    assert.equal(board.events[0]!.new_leader, true);
  });

  it('a finish event is at the finish punch, not at the readout', async () => {
    // No drawn start: timed from the start punch, read out a minute later.
    handle.sqlite.prepare(`UPDATE competitors SET start_time_ms = NULL WHERE id = 'r1'`).run();
    readOut(0, 30);
    const board = await getBoard();
    assert.equal(board.classes[0]!.runners[0]!.finish?.elapsed_ms, 30 * MIN);
    assert.equal(board.events.find((e) => e.kind === 'finish')!.at_ms, START + 30 * MIN);
  });

  it('splits run from the start punch in a start-punch class', async () => {
    // Drawn 10:00, punched start 10:05: the radio split at 10:15 is 10 min.
    handle.sqlite.prepare(`UPDATE classes SET start_method = 'start_punch' WHERE id = 'c1'`).run();
    radioAt(50, 15);
    readOut(5, 30);
    const r = (await getBoard()).classes[0]!.runners[0]!;
    assert.equal(r.passings[0]?.elapsed_ms, 10 * MIN);
    assert.equal(r.finish?.elapsed_ms, 25 * MIN);
  });

  it('a manual finish sets the clock time; a time addition does not move it', async () => {
    readOut(0, 30);
    ev('manual_finish_set', START + 40 * MIN, {
      competitor_id: 'r1',
      finish_ms: START + 29 * MIN,
      reason: 'test',
    });
    ev('time_addition_set', START + 41 * MIN, { competitor_id: 'r1', minutes: 2, reason: 'test' });
    const board = await getBoard();
    assert.equal(board.classes[0]!.runners[0]!.finish?.elapsed_ms, 31 * MIN);
    assert.equal(board.events.find((e) => e.kind === 'finish')!.at_ms, START + 29 * MIN);
  });

  it('404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/speaker' });
    assert.equal(res.statusCode, 404);
  });
});
