// Authored for fartola. Not ported from upstream.
//
// TDD tests for the lottning (start list draw) route.
// Phase 2.1 D-03/D-04/D-05/D-06/D-07.
//
// Routes tested:
//   POST /api/competitions/:id/lottning/:classId
//   GET  /api/competitions/:id/lottning/:classId
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-02-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { competitions, classes, competitors } from '../db/schema.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
  classId: string;
  otherClassId: string;
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

  // Create a competition
  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Test Cup',
      date: '2026-05-24',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
    })
    .run();

  // Create two classes
  const classId = crypto.randomUUID();
  const otherClassId = crypto.randomUUID();
  handle.db
    .insert(classes)
    .values([
      {
        id: classId,
        competitionId,
        name: 'H21',
        shortName: null,
        firstStartMs: null,
        startIntervalSec: null,
        maxTimeSec: null,
      },
      {
        id: otherClassId,
        competitionId,
        name: 'D21',
        shortName: null,
        firstStartMs: null,
        startIntervalSec: null,
        maxTimeSec: null,
      },
    ])
    .run();

  // Insert 5 competitors in H21 from 2 clubs
  const h21Runners: Array<[string, number]> = [
    ['Alpha', 3],
    ['Beta', 2],
  ];
  let idx = 0;
  for (const [club, count] of h21Runners) {
    for (let i = 0; i < count; i++) {
      handle.db
        .insert(competitors)
        .values({
          id: crypto.randomUUID(),
          competitionId,
          name: `Runner ${idx++}`,
          club,
          classId,
          cardNumber: null,
          consentAtMs: null,
          consentStatus: 'explicit',
          scrubbedAtMs: null,
          source: 'walkup',
          startTimeMs: null,
        })
        .run();
    }
  }

  // Insert 3 competitors in D21
  for (let i = 0; i < 3; i++) {
    handle.db
      .insert(competitors)
      .values({
        id: crypto.randomUUID(),
        competitionId,
        name: `D-Runner ${i}`,
        club: 'Gamma',
        classId: otherClassId,
        cardNumber: null,
        consentAtMs: null,
        consentStatus: 'explicit',
        scrubbedAtMs: null,
        source: 'walkup',
        startTimeMs: null,
      })
      .run();
  }

  return { app, handle, competitionId, classId, otherClassId };
}

describe('lottning route', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: POST SOFT → 201 with { drawn: 5 }, all competitors have start_time_ms', async () => {
    const firstStartMs = 10 * 3600 * 1000;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const nonNull = rows.filter((r) => r.startTimeMs !== null);
    assert.equal(nonNull.length, 5);
  });

  test('test 2: start_time_ms values spaced by intervalSec', async () => {
    const firstStartMs = 10 * 3600 * 1000;
    const intervalSec = 60;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec },
    });

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .orderBy(asc(competitors.startTimeMs))
      .all();

    const times = rows.map((r) => r.startTimeMs as number);
    assert.equal(times[0], firstStartMs);
    for (let i = 1; i < times.length; i++) {
      assert.equal(times[i] - times[i - 1], intervalSec * 1000);
    }
  });

  test('test 3: vacant slots create gaps in the time sequence', async () => {
    const firstStartMs = 10 * 3600 * 1000;
    const intervalSec = 60;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec, vacantSlots: 2 },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    // With 2 vacants, at least one gap should be > intervalSec * 1000 ms
    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .orderBy(asc(competitors.startTimeMs))
      .all();
    const times = rows.map((r) => r.startTimeMs as number);
    const hasGap = times.some((_, i) => i > 0 && times[i] - times[i - 1] > intervalSec * 1000);
    assert.ok(hasGap, `Expected a gap > ${intervalSec}s but times were ${times.join(',')}`);
  });

  test('test 4: POST mode=Random → 201, all competitors have start_time_ms', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: 9 * 3600 * 1000, intervalSec: 120 },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const nonNull = rows.filter((r) => r.startTimeMs !== null);
    assert.equal(nonNull.length, 5);
  });

  test('test 5: POST mode=Simultaneous → all competitors have same start_time_ms', async () => {
    const firstStartMs = 11 * 3600 * 1000;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Simultaneous', firstStartMs, intervalSec: 0 },
    });
    assert.equal(res.statusCode, 201, res.body);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const times = rows.map((r) => r.startTimeMs);
    assert.ok(
      times.every((t) => t === firstStartMs),
      `Not all same: ${times.join(',')}`
    );
  });

  test('test 6: re-lotta clears old times, other class untouched', async () => {
    // First draw on H21
    const firstStartMs = 10 * 3600 * 1000;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });

    // Draw D21
    const d21FirstStart = 10 * 3600 * 1000 + 300_000;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.otherClassId}`,
      payload: { mode: 'SOFT', firstStartMs: d21FirstStart, intervalSec: 60 },
    });

    // Re-lotta H21 with different time
    const newFirstStartMs = 11 * 3600 * 1000;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: newFirstStartMs, intervalSec: 90 },
    });
    assert.equal(res.statusCode, 201);

    // H21 times must all be >= newFirstStartMs
    const h21Rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const h21Times = h21Rows.map((r) => r.startTimeMs as number);
    assert.ok(
      h21Times.every((t) => t >= newFirstStartMs),
      `Some H21 times before new start: ${h21Times.join(',')}`
    );

    // D21 times should still be set (other class untouched)
    const d21Rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.otherClassId))
      .all();
    const d21NonNull = d21Rows.filter((r) => r.startTimeMs !== null);
    assert.equal(d21NonNull.length, 3, 'D21 times should still be set');
  });

  test('test 7: unknown class → 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${crypto.randomUUID()}`,
      payload: { mode: 'SOFT', firstStartMs: 36000000, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 8: class belongs to different competition → 404', async () => {
    const otherId = crypto.randomUUID();
    ctx.handle.db
      .insert(competitions)
      .values({
        id: otherId,
        name: 'Other Cup',
        date: '2026-05-25',
        receiptTemplate: 'classic',
        autoPrint: false,
        createdAtMs: Date.now(),
      })
      .run();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${otherId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs: 36000000, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 9: classes.firstStartMs and startIntervalSec updated on class row after draw', async () => {
    const firstStartMs = 10 * 3600 * 1000;
    const intervalSec = 90;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec },
    });

    const cls = ctx.handle.db
      .select({ firstStartMs: classes.firstStartMs, startIntervalSec: classes.startIntervalSec })
      .from(classes)
      .where(eq(classes.id, ctx.classId))
      .get();
    assert.equal(cls?.firstStartMs, firstStartMs);
    assert.equal(cls?.startIntervalSec, intervalSec);
  });

  test('test 10: intervalSec=0 with mode=SOFT → 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs: 36000000, intervalSec: 0 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 10b: intervalSec=0 with mode=Random → 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: 36000000, intervalSec: 0 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 11: intervalSec=0 with mode=Simultaneous → 201', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Simultaneous', firstStartMs: 36000000, intervalSec: 0 },
    });
    assert.equal(res.statusCode, 201);
  });

  test('GET lottning returns sorted start list', async () => {
    const firstStartMs = 10 * 3600 * 1000;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      class: { id: string; first_start_ms: number; start_interval_sec: number };
      start_list: Array<{ id: string; start_time_ms: number }>;
    };
    assert.equal(body.class.id, ctx.classId);
    assert.equal(body.start_list.length, 5);
    for (let i = 1; i < body.start_list.length; i++) {
      assert.ok(
        body.start_list[i].start_time_ms >= body.start_list[i - 1].start_time_ms,
        'Start list not sorted'
      );
    }
  });
});
