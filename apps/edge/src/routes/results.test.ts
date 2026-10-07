// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET /api/competitions/:id/results (plan 08 task 1).
//
// Tests:
//   1. Unknown competition → 404.
//   2. Seeded competition with no events → 200 with empty rows + pending_unknown_cards=[].
//   3. After a card_read event lands + markDirty + recompute, the response
//      reflects the OK row.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, controls, courses, courseControls, competitors, events } from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });
  return { app, handle, nodeId };
}

function seedCompetition(handle: DbHandle, id: string): { classId: string; competitorId: string } {
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
       VALUES (?, ?, ?, 'classic', 0, ?, 0)`
    )
    .run(id, `Comp ${id}`, '2026-05-14', 1_000);
  const classId = `cls-${id}`;
  handle.db.insert(classes).values({ id: classId, competitionId: id, name: 'H21' }).run();
  const controlId = `ctl-${id}-31`;
  handle.db.insert(controls).values({ id: controlId, competitionId: id, code: 31 }).run();
  const courseId = `crs-${id}`;
  handle.db
    .insert(courses)
    .values({ id: courseId, competitionId: id, name: 'A', classId, lengthM: 1000 })
    .run();
  handle.db
    .insert(courseControls)
    .values({ id: `cc-${id}-1`, courseId, controlId, orderIdx: 0 })
    .run();
  const competitorId = `cmp-${id}`;
  handle.db
    .insert(competitors)
    .values({
      id: competitorId,
      competitionId: id,
      name: 'Anna',
      club: 'Test',
      classId,
      cardNumber: 7501853,
      consentAtMs: 1_000,
      consentStatus: 'explicit',
      scrubbedAtMs: null,
    })
    .run();
  return { classId, competitorId };
}

describe('GET /api/competitions/:id/results', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: unknown competition → 404', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/does-not-exist/results',
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 2: seeded competition with no events → 200 with empty rows', async () => {
    seedCompetition(ctx.handle, 'comp-2');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-2/results',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      competition_id: string;
      classes: Array<{ class_id: string; class_name: string; rows: unknown[] }>;
      pending_unknown_cards: number[];
      last_event_seq: number;
    };
    assert.equal(body.competition_id, 'comp-2');
    assert.equal(body.classes.length, 1);
    assert.equal(body.classes[0]!.class_name, 'H21');
    // One competitor in the class — projection seeds them as PEND.
    assert.equal(body.classes[0]!.rows.length, 1);
    const row = body.classes[0]!.rows[0] as { status: string };
    assert.equal(row.status, 'PEND');
    assert.deepEqual(body.pending_unknown_cards, []);
    assert.equal(body.last_event_seq, 0);
  });

  test('test 3: after a card_read event + markDirty + recompute → OK row reflected', async () => {
    seedCompetition(ctx.handle, 'comp-3');
    // Insert a full-shape card_read event directly. Use a HalfDayClock with
    // start=09:00 and finish=09:30 — elapsed = 30 min. Punches[31] satisfies
    // the one-control course.
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: ctx.nodeId,
        localSeq: 1,
        competitionId: 'comp-3',
        eventType: 'card_read',
        eventTimeMs: 100,
        recordedAtMs: 100,
        payload: {
          event_type: 'card_read',
          card_number: 7501853,
          card_type: 'SI10',
          start: { half_day: 0, seconds_in_half_day: 9 * 3600, weekday: null },
          finish: { half_day: 0, seconds_in_half_day: 9 * 3600 + 30 * 60, weekday: null },
          check: null,
          clear: null,
          punch_count: 1,
          punches: [
            {
              code: 31,
              seconds_in_half_day: 9 * 3600 + 15 * 60,
              half_day: 0,
              weekday: null,
            },
          ],
          card_holder: null,
        },
      })
      .run();
    // First GET triggers recomputeNow (cache is empty on a fresh boot).
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-3/results',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      classes: Array<{
        rows: Array<{ status: string; elapsed_time_ms: number | null; place: number | null }>;
      }>;
      last_event_seq: number;
    };
    assert.equal(body.classes.length, 1);
    assert.equal(body.classes[0]!.rows.length, 1);
    const row = body.classes[0]!.rows[0]!;
    assert.equal(row.status, 'OK');
    assert.equal(row.elapsed_time_ms, 30 * 60 * 1000);
    assert.equal(row.place, 1);
    assert.equal(body.last_event_seq, 1);
  });

  test('SOFT TA till TR 7.8.2: rows carry the SOFT status name; a runner not read out is "Ej utläst" live', async () => {
    const { classId } = seedCompetition(ctx.handle, 'comp-4');
    // Bo is disqualified by hand; Anna (seeded) has not been read out.
    ctx.handle.db
      .insert(competitors)
      .values({
        id: 'cmp-bo',
        competitionId: 'comp-4',
        name: 'Bo',
        club: 'Test',
        classId,
        cardNumber: 7501854,
        consentAtMs: 1_000,
        consentStatus: 'explicit',
        scrubbedAtMs: null,
      })
      .run();
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: ctx.nodeId,
        localSeq: 1,
        competitionId: 'comp-4',
        eventType: 'manual_status_set',
        eventTimeMs: 100,
        recordedAtMs: 100,
        payload: {
          event_type: 'manual_status_set',
          competitor_id: 'cmp-bo',
          status: 'DQ',
          reason: 'Regelbrott',
        },
      })
      .run();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/competitions/comp-4/results' });
    assert.equal(res.statusCode, 200);
    const rows = (
      res.json() as { classes: Array<{ rows: Array<{ name: string; soft_status: string }> }> }
    ).classes[0]!.rows;
    assert.deepEqual(
      rows.map((r) => [r.name, r.soft_status]),
      [
        ['Bo', 'DISKAD'],
        ['Anna', 'EJ_UTLAST'],
      ]
    );
  });
});
