// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET /api/competitions/:id/runner-status.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, competitors, events } from '../db/schema.ts';

const COMP = 'comp-rs';

describe('GET /api/competitions/:id/runner-status', () => {
  let app: FastifyInstance;
  let handle: DbHandle;

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    const nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId, projectionDebounceMs: 0 });
    handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms)
         VALUES (?, 'Prov', '2026-10-10', 'classic', 0, 0)`
      )
      .run(COMP);
    handle.db.insert(classes).values({ id: 'h21', competitionId: COMP, name: 'H21' }).run();
    handle.db
      .insert(competitors)
      .values([
        { id: 'a', competitionId: COMP, name: 'Anna', classId: 'h21', cardNumber: 1 },
        { id: 'b', competitionId: COMP, name: 'Bo', classId: 'h21', cardNumber: 2 },
      ])
      .run();
    handle.db
      .insert(events)
      .values({
        nodeId,
        localSeq: 1,
        competitionId: COMP,
        eventType: 'manual_status_set',
        eventTimeMs: 1,
        recordedAtMs: 1,
        payload: {
          event_type: 'manual_status_set',
          competitor_id: 'b',
          status: 'DNS',
          reason: 'x',
        },
      })
      .run();
  });
  afterEach(async () => {
    await app.close();
    handle.close();
  });

  test('gives each runner its status, manual status and missing start', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/runner-status` });
    assert.equal(res.statusCode, 200);
    const { runners } = res.json() as { runners: Array<{ competitor_id: string }> };
    assert.deepEqual(
      runners.sort((x, y) => x.competitor_id.localeCompare(y.competitor_id)),
      [
        { competitor_id: 'a', status: 'PEND', manual_status: null, missing_start: false },
        { competitor_id: 'b', status: 'DNS', manual_status: 'DNS', missing_start: false },
      ]
    );
  });

  test('404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/runner-status' });
    assert.equal(res.statusCode, 404);
  });
});
