// Authored for fartola. Not ported from upstream.
//
// Start times as events (ADR-0003 update 2026-10) and undo (ADR-0016 rule 2).

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { classes, competitions, competitors, events, type EventPayload } from '../db/schema.ts';
import { rebuildStartTimeCache } from '../db/startTimes.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

const at = (h: number, m = 0): number => localToEpochMs('2026-05-24', h * 3600 + m * 60);

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
  classId: string;
  ids: string[];
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
    .values({ id: classId, competitionId, name: 'H21', classKind: 'senior', ageClass: 21 })
    .run();
  const ids = ['Alpha', 'Alpha', 'Beta'].map((club, i) => {
    const id = crypto.randomUUID();
    handle.db
      .insert(competitors)
      .values({ id, competitionId, name: `Runner ${i}`, club, classId })
      .run();
    return id;
  });
  return { app, handle, competitionId, classId, ids };
}

describe('start times as events', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  const startEvents = () =>
    ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.eventType, 'start_times_set'))
      .all()
      .map((e) => e.payload as Extract<EventPayload, { event_type: 'start_times_set' }>);
  const column = () =>
    new Map(
      ctx.handle.db
        .select({ id: competitors.id, t: competitors.startTimeMs })
        .from(competitors)
        .all()
        .map((r) => [r.id, r.t])
    );
  /** The projection's start for every runner equals the stored cache. */
  const assertProjectionMatchesColumn = () => {
    const state = ctx.app.projectionStore.recomputeNow(ctx.competitionId)!;
    for (const [id, t] of column()) assert.equal(state.competitors.get(id)!.start_time_ms, t, id);
  };
  const post = (url: string, payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}${url}`,
      payload,
    });
  const history = async () =>
    (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${ctx.competitionId}/start-times/history`,
      })
    ).json() as {
      items: Array<{ node_id: string; local_seq: number; cause: string; undone: boolean }>;
    };

  test('ADR-0003: a draw, a hand edit and applied missing starts each write one event; the projection derives every start', async () => {
    const draw = await post(`/lottning/${ctx.classId}`, {
      mode: 'SOFT',
      firstStartMs: at(10),
      intervalSec: 60,
    });
    assert.equal(draw.statusCode, 201, draw.body);
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${ctx.ids[0]}/start-time`,
      payload: { start_time_ms: at(12) },
    });
    assert.equal(edit.statusCode, 200, edit.body);
    const apply = await post('/missing-starts/apply', {
      items: [{ competitor_id: ctx.ids[1], start_time_ms: at(13) }],
    });
    assert.equal(apply.statusCode, 200, apply.body);
    assert.deepEqual(
      startEvents().map((e) => [e.cause, e.changes.length]),
      [
        ['draw', 3],
        ['manual', 1],
        ['missing_starts', 1],
      ]
    );
    assertProjectionMatchesColumn();
  });

  test('ADR-0016 rule 2: undo a redraw → every start and the class grid are back; undo twice → 409', async () => {
    const draw = (firstStartMs: number, intervalSec: number) =>
      post(`/lottning/${ctx.classId}`, { mode: 'SOFT', firstStartMs, intervalSec });
    assert.equal((await draw(at(10), 60)).statusCode, 201);
    const first = column();
    assert.equal((await draw(at(11), 120)).statusCode, 201);
    const redraw = (await history()).items[0]!;
    assert.equal(redraw.cause, 'draw');
    const undo = await post('/start-times/undo', {
      node_id: redraw.node_id,
      local_seq: redraw.local_seq,
    });
    assert.equal(undo.statusCode, 201, undo.body);
    assert.deepEqual(column(), first);
    const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.classId)).get()!;
    assert.deepEqual([cls.firstStartMs, cls.startIntervalSec], [at(10), 60]);
    assertProjectionMatchesColumn();
    const again = await post('/start-times/undo', {
      node_id: redraw.node_id,
      local_seq: redraw.local_seq,
    });
    assert.equal(again.statusCode, 409);
    assert.equal((again.json() as { error: string }).error, 'already_undone');
    assert.deepEqual(
      (await history()).items.map((i) => [i.cause, i.undone]),
      [
        ['undo', false],
        ['draw', true],
        ['draw', false],
      ]
    );
  });

  test('undo after a later change to the same runner → 409 start_changed_since, nothing written', async () => {
    assert.equal(
      (
        await post(`/lottning/${ctx.classId}`, {
          mode: 'SOFT',
          firstStartMs: at(10),
          intervalSec: 60,
        })
      ).statusCode,
      201
    );
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${ctx.ids[2]}/start-time`,
      payload: { start_time_ms: at(14) },
    });
    const before = startEvents().length;
    const drawEvent = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.eventType, 'start_times_set'))
      .all()[0]!;
    const res = await post('/start-times/undo', {
      node_id: drawEvent.nodeId,
      local_seq: drawEvent.localSeq,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.deepEqual(res.json(), { error: 'start_changed_since', competitor_ids: [ctx.ids[2]] });
    assert.equal(startEvents().length, before);
  });

  test('ADR-0003: rebuilding from the events rewrites the start-time cache', async () => {
    assert.equal(
      (
        await post(`/lottning/${ctx.classId}`, {
          mode: 'SOFT',
          firstStartMs: at(10),
          intervalSec: 60,
        })
      ).statusCode,
      201
    );
    const drawn = column();
    // Corrupt the cache behind the events' back, then rebuild.
    ctx.handle.sqlite.prepare('UPDATE competitors SET start_time_ms = NULL').run();
    ctx.handle.sqlite
      .prepare('UPDATE classes SET first_start_ms = NULL, start_interval_sec = NULL')
      .run();
    assert.equal(rebuildStartTimeCache(ctx.handle), 3);
    assert.deepEqual(column(), drawn);
    const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.classId)).get()!;
    assert.deepEqual([cls.firstStartMs, cls.startIntervalSec], [at(10), 60]);
    assert.equal(rebuildStartTimeCache(ctx.handle), 0, 'idempotent');
  });

  test('ADR-0017: moving the clock offset after a draw moves the events with the cache', async () => {
    assert.equal(
      (
        await post(`/lottning/${ctx.classId}`, {
          mode: 'SOFT',
          firstStartMs: at(10),
          intervalSec: 60,
        })
      ).statusCode,
      201
    );
    const drawn = column();
    // 2026-05-24 is CEST (+120); an operator override of +60 shifts every
    // stored start by one hour to keep its clock time.
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}`,
      payload: { clock_offset_min: 60 },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    for (const [id, t] of column()) assert.equal(t, drawn.get(id)! + 3_600_000, id);
    assertProjectionMatchesColumn();
    const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.classId)).get()!;
    assert.deepEqual([cls.firstStartMs, cls.startIntervalSec], [at(10) + 3_600_000, 60]);
    // A restart rebuilds the same cache from the events.
    const shifted = column();
    assert.equal(rebuildStartTimeCache(ctx.handle), 0);
    assert.deepEqual(column(), shifted);
  });

  test('start times fold in write order: a laptop clock set back does not revert a later edit', async (t) => {
    assert.equal(
      (
        await post(`/lottning/${ctx.classId}`, {
          mode: 'SOFT',
          firstStartMs: at(10),
          intervalSec: 60,
        })
      ).statusCode,
      201
    );
    const now = Date.now();
    t.mock.method(Date, 'now', () => now - 120_000);
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${ctx.ids[0]}/start-time`,
      payload: { start_time_ms: at(12) },
    });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal(column().get(ctx.ids[0]!), at(12));
    assertProjectionMatchesColumn();
    const edited = column();
    rebuildStartTimeCache(ctx.handle);
    assert.deepEqual(column(), edited, 'a restart keeps the edit');
  });

  test('a clock shift cannot be undone (409): it is not a start-time decision', async () => {
    assert.equal(
      (
        await post(`/lottning/${ctx.classId}`, {
          mode: 'SOFT',
          firstStartMs: at(10),
          intervalSec: 60,
        })
      ).statusCode,
      201
    );
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}`,
      payload: { clock_offset_min: 60 },
    });
    const shift = (await history()).items.find((i) => i.cause === 'clock_shift')!;
    const before = column();
    const res = await post('/start-times/undo', {
      node_id: shift.node_id,
      local_seq: shift.local_seq,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((res.json() as { error: string }).error, 'clock_shift_not_undoable');
    assert.deepEqual(column(), before);
  });

  test('undo after a later grid change → 409 grid_changed_since, nothing written', async () => {
    const draw = (intervalSec: number) =>
      post(`/lottning/${ctx.classId}`, { mode: 'Simultaneous', firstStartMs: at(10), intervalSec });
    for (const s of [60, 120, 180]) assert.equal((await draw(s)).statusCode, 201);
    const second = (await history()).items.find((i) => i.local_seq === 2)!;
    const before = startEvents().length;
    // Mass start: every runner keeps the same time, only the grid differs.
    const res = await post('/start-times/undo', {
      node_id: second.node_id,
      local_seq: second.local_seq,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((res.json() as { error: string }).error, 'grid_changed_since');
    assert.equal(startEvents().length, before);
    const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.classId)).get()!;
    assert.equal(cls.startIntervalSec, 180);
  });

  test('history is newest first by write order, not by the laptop clock', async (t) => {
    await post(`/lottning/${ctx.classId}`, { mode: 'SOFT', firstStartMs: at(10), intervalSec: 60 });
    const now = Date.now();
    t.mock.method(Date, 'now', () => now - 120_000);
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${ctx.ids[0]}/start-time`,
      payload: { start_time_ms: at(12) },
    });
    assert.deepEqual(
      (await history()).items.map((i) => i.local_seq),
      [2, 1]
    );
  });

  test('the same runner twice in one request → one change, so undo works', async () => {
    const res = await post('/missing-starts/apply', {
      items: [
        { competitor_id: ctx.ids[0], start_time_ms: at(12) },
        { competitor_id: ctx.ids[0], start_time_ms: at(13) },
      ],
    });
    assert.equal(res.statusCode, 200, res.body);
    const item = (await history()).items[0]!;
    const undo = await post('/start-times/undo', {
      node_id: item.node_id,
      local_seq: item.local_seq,
    });
    assert.equal(undo.statusCode, 201, undo.body);
    assert.equal(column().get(ctx.ids[0]!), null);
  });

  test('a write that changes nothing writes no event', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${ctx.ids[0]}/start-time`,
      payload: { start_time_ms: null },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(startEvents().length, 0);
  });
});
