// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.22.1: GET /api/competitions/:id/in-forest and the radio side of
// the check-unit snapshot, against an in-memory database. Synthetic runners
// and card numbers only.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

const COMP = 'comp-1';
const DATE = '2026-10-04';
const START = localToEpochMs(DATE, 10 * 3600);
const MIN = 60_000;
const CARD = 9000001;

interface Row {
  card_number: number;
  name: string | null;
  no_check: boolean;
  sources: Array<{ kind: string; code?: number }>;
}

describe('SOFT TR 4.22.1: in forest', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let nodeId: string;

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId });
    const run = (sql: string, ...args: unknown[]) => handle.sqlite.prepare(sql).run(...args);
    run(
      `INSERT INTO competitions (id, name, date, created_at_ms, roc_check_codes, roc_finish_codes) VALUES (?, 'C1', ?, 0, '71', '99')`,
      COMP,
      DATE
    );
    run(`INSERT INTO classes (id, competition_id, name) VALUES ('c1', ?, 'H21')`, COMP);
    run(
      `INSERT INTO competitors (id, competition_id, name, club, class_id, card_number, start_time_ms, source, consent_status)
       VALUES ('r1', ?, 'Anna Test', 'OK Test', 'c1', ?, ?, 'entrylist', 'implicit')`,
      COMP,
      CARD,
      START
    );
  });

  afterEach(async () => {
    await app.close();
    handle.close();
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
  const clock = (min: number) => ({
    seconds_in_half_day: 10 * 3600 + min * 60,
    half_day: 0 as const,
    weekday: null,
  });
  const radio = (code: number, min: number, card = CARD) =>
    ev('radio_punch', START + min * MIN, {
      source: 'roc',
      idempotency_key: `2380:${code}:${min}:${card}`,
      roc_id: min,
      card_number: card,
      control_code: code,
      time_of_day: `10:${String(min).padStart(2, '0')}:00`,
      received_at_ms: START + min * MIN + 5_000,
      roc_date: DATE,
      date_mismatch: false,
    });
  const read = (finishMin: number | null, checkMin: number | null = null) =>
    ev('card_read', START + 60 * MIN, {
      card_number: CARD,
      card_type: 'SI10',
      start: clock(0),
      finish: finishMin === null ? null : clock(finishMin),
      check: checkMin === null ? null : clock(checkMin),
      clear: null,
      punch_count: 0,
      punches: [],
      card_holder: null,
    });
  const list = async () =>
    (await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/in-forest` })).json() as {
      runners: Row[];
      updated: { radio_last_punch_at_ms: number | null; checkunit_read_at_ms: number | null };
    };
  const snapshotNoReader = () =>
    app.inject({ method: 'POST', url: `/api/competitions/${COMP}/checkunit/snapshot` });

  it('SOFT TR 4.22.1: a runner seen only at a radio control is in the forest', async () => {
    radio(50, 12);
    const { runners, updated } = await list();
    assert.equal(runners.length, 1);
    assert.equal(runners[0]?.name, 'Anna Test');
    assert.deepEqual(runners[0]?.sources, [{ kind: 'radio', code: 50 }]);
    assert.equal(updated.radio_last_punch_at_ms, START + 12 * MIN + 5_000);
  });

  it('SOFT TR 4.22.1: radio without a check punch gets the flag, with one it does not', async () => {
    radio(50, 12);
    assert.equal((await list()).runners[0]?.no_check, true);
    radio(71, 1);
    assert.equal((await list()).runners[0]?.no_check, false);
  });

  it('SOFT TR 4.22.1: a start punch in a card read puts the runner in the forest', async () => {
    read(null);
    const { runners } = await list();
    assert.deepEqual(runners[0]?.sources, [{ kind: 'read' }]);
  });

  it('SOFT TR 4.22.1: a runner with a finish read is not in the forest', async () => {
    radio(50, 12);
    read(40);
    assert.equal((await list()).runners.length, 0);
  });

  it('SOFT TR 4.22.1: a manual finish time takes the runner out of the forest', async () => {
    radio(50, 12);
    ev('manual_finish_set', START + 50 * MIN, {
      competitor_id: 'r1',
      finish_ms: START + 45 * MIN,
      reason: 'finish unit failed',
    });
    assert.equal((await list()).runners.length, 0);
  });

  it('SOFT TR 4.22.1: a status set by hand takes the runner out of the forest', async () => {
    radio(50, 12);
    ev('manual_status_set', START + 50 * MIN, {
      competitor_id: 'r1',
      status: 'DNF',
      reason: 'utgatt',
    });
    assert.equal((await list()).runners.length, 0);
  });

  it('SOFT TR 4.22.1: a radio finish unit alone does not list the runner', async () => {
    radio(99, 40);
    assert.equal((await list()).runners.length, 0);
  });

  it('SOFT TR 4.22.1: snapshot without a reader answers from radio data', async () => {
    radio(50, 12);
    const res = await snapshotNoReader();
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      cardNumbers: number[];
      returnedCardNumbers: number[];
      checkunit: string;
      noCheckCardNumbers: number[];
    };
    assert.deepEqual(body.cardNumbers, [CARD]);
    assert.deepEqual(body.returnedCardNumbers, []);
    assert.equal(body.checkunit, 'unavailable');
    assert.deepEqual(body.noCheckCardNumbers, [CARD]);
  });

  it('SOFT TR 4.22.1: snapshot without a reader and nobody in the forest stays 503', async () => {
    radio(50, 12);
    read(40);
    const res = await snapshotNoReader();
    assert.equal(res.statusCode, 503);
  });

  it('SOFT TR 4.22.1: a stored check-unit read lists its cards with no reader, check unit only', async () => {
    handle.sqlite
      .prepare(
        `UPDATE competitions SET checkunit_cards = ?, checkunit_overflow = 0, checkunit_read_at_ms = ? WHERE id = ?`
      )
      .run(JSON.stringify([CARD, 9000002]), START, COMP);
    const { runners, updated } = await list();
    assert.deepEqual(
      runners.map((r) => r.card_number),
      [CARD, 9000002]
    );
    assert.deepEqual(runners[0]?.sources, [{ kind: 'checkunit' }]);
    assert.equal(runners[0]?.no_check, false);
    assert.equal(updated.checkunit_read_at_ms, START);
  });
});
