// Authored for fartola. Not ported from upstream.
//
// GET /api/competitions/:id/radio/status and PATCH .../radio/settings.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RadioStatus } from '@fartola/shared-types';

import { buildServer } from '../server.ts';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { epochToWallClockMs } from '../time/competitionClock.ts';

const COMP = 'comp-1';

describe('radio routes', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let nodeId: string;

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId });
    handle.sqlite
      .prepare(`INSERT INTO competitions (id, name, date, created_at_ms) VALUES (?, 'C1', ?, 0)`)
      .run(COMP, new Date().toISOString().slice(0, 10));
  });

  afterEach(async () => {
    await app.close();
    handle.close();
  });

  const patch = (payload: unknown, remoteAddress = '127.0.0.1') =>
    app.inject({
      method: 'PATCH',
      url: `/api/competitions/${COMP}/radio/settings`,
      remoteAddress,
      payload: payload as object,
    });

  it('status: 404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/radio/status' });
    assert.equal(res.statusCode, 404);
  });

  it('status: settings default to off, no controls, no poller', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/radio/status` });
    assert.equal(res.statusCode, 200);
    const body = res.json<RadioStatus>();
    assert.deepEqual(body.settings, {
      enabled: false,
      roc_competition_id: null,
      start_id: null,
      last_id: null,
      radio_controls: [],
      start_codes: [],
      check_codes: [],
      finish_codes: [],
      heard_codes: [],
    });
    assert.equal(body.poll, null);
    assert.deepEqual(body.controls, []);
  });

  it('settings: set id and enable; enabling without an id is a 400', async () => {
    assert.equal((await patch({ enabled: true })).statusCode, 400);
    const res = await patch({ roc_competition_id: '2380', enabled: true });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json<RadioStatus>().settings.enabled, true);
    assert.equal(res.json<RadioStatus>().settings.roc_competition_id, '2380');
    assert.equal((await patch({ roc_competition_id: 'abc' })).statusCode, 400);
  });

  it('settings: a new ROC id forgets the stored ids; an explicit start id is kept', async () => {
    handle.sqlite
      .prepare(`UPDATE competitions SET roc_competition_id='1', roc_start_id=5, roc_last_id=9`)
      .run();
    const changed = await patch({ roc_competition_id: '2380' });
    assert.equal(changed.json<RadioStatus>().settings.last_id, null);
    assert.equal(changed.json<RadioStatus>().settings.start_id, null);
    const explicit = await patch({ start_id: 77 });
    assert.equal(explicit.json<RadioStatus>().settings.start_id, 77);
  });

  it('settings: expected radio controls are stored sorted and shown as listed', async () => {
    const res = await patch({ radio_controls: [100, 52, 52] });
    assert.deepEqual(res.json<RadioStatus>().settings.radio_controls, [52, 100]);
    assert.deepEqual(
      res.json<RadioStatus>().controls.map((c) => [c.control_code, c.listed]),
      [
        [52, true],
        [100, true],
      ]
    );
    const cleared = await patch({ radio_controls: [] });
    assert.deepEqual(cleared.json<RadioStatus>().settings.radio_controls, []);
  });

  it('settings: start, check and finish unit codes are stored; heard codes are suggested', async () => {
    const res = await patch({
      start_codes: [13, 3],
      check_codes: [22, 2, 12],
      finish_codes: [20, 10],
    });
    const body = res.json<RadioStatus>();
    assert.deepEqual(body.settings.start_codes, [3, 13]);
    assert.deepEqual(body.settings.check_codes, [2, 12, 22]);
    assert.deepEqual(body.settings.finish_codes, [10, 20]);
    // Listed units are shown (role + unit) even before anything is heard.
    assert.deepEqual(
      body.controls.map((c) => [c.role, c.control_code]),
      [
        ['start', 3],
        ['start', 13],
        ['check', 2],
        ['check', 12],
        ['check', 22],
        ['finish', 10],
        ['finish', 20],
      ]
    );
  });

  it('settings: a write from another machine needs the event code', async () => {
    const res = await patch({ enabled: false }, '10.0.0.5');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json<{ error: string }>().error, 'event_code_required');
  });

  it('status: lists a radio control with its coverage and date warnings', async () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      insertEvent(
        handle,
        nodeId,
        'radio_punch',
        now - 60_000 * (i + 1),
        {
          event_type: 'radio_punch',
          source: 'roc',
          idempotency_key: `900000${i}:78:x${i}`,
          roc_id: i,
          card_number: 9_000_000 + i,
          control_code: 78,
          time_of_day: '10:00:00',
          wall_ms: epochToWallClockMs(now - 60_000 * (i + 1)),
          received_at_ms: now - 60_000 * (i + 1),
          roc_date: '2020-01-01',
          date_mismatch: true,
        },
        COMP
      );
    }
    const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/radio/status` });
    const [c] = res.json<RadioStatus>().controls;
    assert.equal(c!.control_code, 78);
    assert.equal(c!.received, 3);
    assert.equal(c!.date_mismatch_count, 3);
    assert.equal(c!.state, 'ok');
    assert.ok(Math.abs(c!.last_heard_ms! - (now - 60_000)) < 1000);
  });
});
