// Authored for fartola. Not ported from upstream.
//
// TDD tests for the PATCH class route (maxTimeSec).
// Phase 2.1 D-08.
//
// Routes tested:
//   PATCH /api/competitions/:id/classes/:classId
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-02-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { competitions, classes } from '../db/schema.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
  classId: string;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });

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

  const classId = crypto.randomUUID();
  handle.db
    .insert(classes)
    .values({
      id: classId,
      competitionId,
      name: 'H21',
      shortName: null,
      firstStartMs: null,
      startIntervalSec: null,
      maxTimeSec: null,
    })
    .run();

  return { app, handle, competitionId, classId };
}

describe('classes route (PATCH maxTimeSec)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 12: PATCH with maxTimeSec → 200, class row updated', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
      payload: { maxTimeSec: 3600 },
    });
    assert.equal(res.statusCode, 200, res.body);

    const { eq } = await import('drizzle-orm');
    const cls = ctx.handle.db
      .select({ maxTimeSec: classes.maxTimeSec })
      .from(classes)
      .where(eq(classes.id, ctx.classId))
      .get();
    assert.equal(cls?.maxTimeSec, 3600);
  });

  test('test 13: PATCH with maxTimeSec=null → 200, max time cleared', async () => {
    // First set it
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
      payload: { maxTimeSec: 3600 },
    });

    // Then clear it
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
      payload: { maxTimeSec: null },
    });
    assert.equal(res.statusCode, 200, res.body);

    const { eq } = await import('drizzle-orm');
    const cls = ctx.handle.db
      .select({ maxTimeSec: classes.maxTimeSec })
      .from(classes)
      .where(eq(classes.id, ctx.classId))
      .get();
    assert.equal(cls?.maxTimeSec, null);
  });

  test('PATCH unknown class → 404', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${crypto.randomUUID()}`,
      payload: { maxTimeSec: 3600 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('PATCH class from different competition → 404', async () => {
    // Create another competition
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
      method: 'PATCH',
      url: `/api/competitions/${otherId}/classes/${ctx.classId}`,
      payload: { maxTimeSec: 3600 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('PATCH with invalid maxTimeSec type → 400', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
      payload: { maxTimeSec: 'not-a-number' },
    });
    assert.equal(res.statusCode, 400);
  });

  // 02.1-14 Task 9: classes without timing.
  test('PATCH no_timing toggles the flag, keeps maxTimeSec, shows in the DTO', async () => {
    const url = `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`;
    await ctx.app.inject({ method: 'PATCH', url, payload: { maxTimeSec: 3600 } });

    const on = await ctx.app.inject({ method: 'PATCH', url, payload: { no_timing: true } });
    assert.equal(on.statusCode, 200);
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${ctx.competitionId}/classes`,
    });
    const dto = (list.json() as { classes: Array<{ id: string; no_timing: boolean }> }).classes;
    assert.equal(dto.find((c) => c.id === ctx.classId)?.no_timing, true);
    const row = ctx.handle.db.select().from(classes).get();
    assert.equal(row?.maxTimeSec, 3600, 'maxTimeSec untouched by a no_timing PATCH');

    const off = await ctx.app.inject({ method: 'PATCH', url, payload: { no_timing: false } });
    assert.equal(off.statusCode, 200);
    assert.equal(ctx.handle.db.select().from(classes).get()?.noTiming, false);
  });

  // 02.1-14 Task 14: start method per class (replaces Task 11's
  // ignore_start_punch). Default 'auto'.
  test('PATCH start_method sets it and shows in the DTO; unknown value → 400', async () => {
    const url = `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`;
    const listed = async () =>
      (
        (
          await ctx.app.inject({
            method: 'GET',
            url: `/api/competitions/${ctx.competitionId}/classes`,
          })
        ).json() as {
          classes: Array<{ id: string; start_method: string; no_timing: boolean }>;
        }
      ).classes.find((c) => c.id === ctx.classId);
    assert.equal((await listed())?.start_method, 'auto');

    for (const method of ['start_punch', 'start_time', 'auto']) {
      const res = await ctx.app.inject({ method: 'PATCH', url, payload: { start_method: method } });
      assert.equal(res.statusCode, 200);
      assert.equal((await listed())?.start_method, method);
      assert.equal(ctx.handle.db.select().from(classes).get()?.startMethod, method);
    }
    assert.equal((await listed())?.no_timing, false, 'no_timing untouched');

    const bad = await ctx.app.inject({ method: 'PATCH', url, payload: { start_method: 'punch' } });
    assert.equal(bad.statusCode, 400);
    const old = await ctx.app.inject({
      method: 'PATCH',
      url,
      payload: { ignore_start_punch: true },
    });
    assert.equal(old.statusCode, 400, 'the Task 11 flag is gone');
  });

  test('PATCH with an empty body → 400', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });
});
