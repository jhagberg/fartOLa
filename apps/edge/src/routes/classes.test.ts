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
import { eq } from 'drizzle-orm';
import { runMigrations } from '../db/migrate.ts';
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

  test('PATCH bib_prefix, bib_base and start_name → stored; empty text clears', async () => {
    const patch = (payload: object) =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/api/competitions/${ctx.competitionId}/classes/${ctx.classId}`,
        payload,
      });
    const row = () =>
      ctx.handle.db
        .select({ p: classes.bibPrefix, b: classes.bibBase, s: classes.startName })
        .from(classes)
        .where(eq(classes.id, ctx.classId))
        .get();
    let res = await patch({ bib_prefix: ' A ', bib_base: 101, start_name: 'Start 1' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(row(), { p: 'A', b: 101, s: 'Start 1' });
    res = await patch({ bib_prefix: '', start_name: null });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(row(), { p: null, b: 101, s: null });
    assert.equal((await patch({ bib_base: -1 })).statusCode, 400);
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

  test('SOFT TR 3.4.2: class kind — suggested from the name on create, none for an unknown name, in the DTO', async () => {
    const create = async (payload: Record<string, unknown>) =>
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/competitions/${ctx.competitionId}/classes`,
          payload,
        })
      ).json() as {
        class_kind: string | null;
        age_class: number | null;
        class_kind_source: string | null;
      };
    const d12 = await create({ name: 'D12' });
    assert.deepEqual(
      [d12.class_kind, d12.age_class, d12.class_kind_source],
      ['ungdom', 12, 'name']
    );
    const unknown = await create({ name: 'Lilla banan' });
    assert.deepEqual([unknown.class_kind, unknown.class_kind_source], [null, null]);
    const chosen = await create({ name: 'Knattar', class_kind: 'inskolning', age_class: null });
    assert.deepEqual([chosen.class_kind, chosen.class_kind_source], ['inskolning', 'operator']);
  });

  test("SOFT TR 3.4.2: kinds preview — Eventor's ClassTypeId over the name; PUT confirms (source operator)", async (t) => {
    ctx.handle.db
      .update(competitions)
      .set({ eventorEventId: 4711 })
      .where(eq(competitions.id, ctx.competitionId))
      .run();
    ctx.handle.sqlite
      .prepare(`INSERT INTO config (key, value) VALUES ('EVENTOR_API_KEY', 'KEY')`)
      .run();
    const lilla = crypto.randomUUID();
    ctx.handle.db
      .insert(classes)
      .values({ id: lilla, competitionId: ctx.competitionId, name: 'Lilla banan' })
      .run();
    t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
      assert.match(String(url), /eventclasses\?eventId=4711$/);
      return new Response(
        '<EventClassList><EventClass><Name>Lilla banan</Name><ClassTypeId>19</ClassTypeId></EventClass>' +
          '<EventClass><Name>H21</Name><ClassTypeId>17</ClassTypeId></EventClass></EventClassList>',
        { status: 200 }
      );
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${ctx.competitionId}/classes/kinds`,
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      eventor: string;
      items: Array<{ class_id: string; class_kind: string | null; suggestion: unknown }>;
    };
    assert.equal(body.eventor, 'used');
    const lillaItem = body.items.find((i) => i.class_id === lilla)!;
    assert.equal(lillaItem.class_kind, null, 'the preview writes nothing');
    assert.deepEqual(lillaItem.suggestion, {
      class_kind: 'oppen',
      age_class: null,
      source: 'eventor',
    });

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/competitions/${ctx.competitionId}/classes/kinds`,
      payload: { items: [{ class_id: lilla, class_kind: 'oppen', age_class: null }] },
    });
    assert.equal(put.statusCode, 200, put.body);
    const row = ctx.handle.db.select().from(classes).where(eq(classes.id, lilla)).get()!;
    assert.deepEqual([row.classKind, row.classKindSource], ['oppen', 'operator']);
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/api/competitions/${ctx.competitionId}/classes/kinds`,
      payload: { items: [{ class_id: 'nope', class_kind: 'oppen', age_class: null }] },
    });
    assert.equal(bad.statusCode, 400);
  });

  test('a class without a kind (before migration 0020) gets the name suggestion on startup; an operator choice stays', () => {
    const id = crypto.randomUUID();
    ctx.handle.sqlite
      .prepare(`INSERT INTO classes (id, competition_id, name) VALUES (?, ?, 'H21 Elit')`)
      .run(id, ctx.competitionId);
    ctx.handle.sqlite
      .prepare(
        `UPDATE classes SET class_kind = 'oppen', class_kind_source = 'operator' WHERE id = ?`
      )
      .run(ctx.classId);
    runMigrations(ctx.handle.sqlite);
    const row = (classId: string) =>
      ctx.handle.db.select().from(classes).where(eq(classes.id, classId)).get()!;
    assert.deepEqual(
      [row(id).classKind, row(id).ageClass, row(id).classKindSource],
      ['elit', 21, 'name']
    );
    assert.equal(row(ctx.classId).classKind, 'oppen', 'an operator choice is never overwritten');
  });

  test('SOFT TR 7.4.1: an age class needs its age: kept from the name, 400 when it cannot be known', async () => {
    const create = (payload: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${ctx.competitionId}/classes`,
        payload,
      });
    const d12 = await create({ name: 'D12', class_kind: 'ungdom' });
    assert.equal(d12.statusCode, 201, d12.body);
    assert.equal((d12.json() as { age_class: number }).age_class, 12);
    const bad = await create({ name: 'Knattar', class_kind: 'ungdom' });
    assert.equal(bad.statusCode, 400);
    assert.equal((bad.json() as { error: string }).error, 'age_class_required');
    const open = await create({ name: 'Lilla', class_kind: 'oppen' });
    assert.equal(open.statusCode, 201, open.body);
    const id = (open.json() as { id: string }).id;
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/competitions/${ctx.competitionId}/classes/kinds`,
      payload: { items: [{ class_id: id, class_kind: 'ungdom', age_class: null }] },
    });
    assert.equal(put.statusCode, 400, put.body);
    assert.equal(
      ctx.handle.db.select().from(classes).where(eq(classes.id, id)).get()!.classKind,
      'oppen',
      'nothing written'
    );
  });

  test("SOFT TR 3.4.2: from-eventor stores source 'eventor' (confirmed) and never overwrites an operator's kind", async (t) => {
    ctx.handle.db
      .update(competitions)
      .set({ eventorEventId: 4711 })
      .where(eq(competitions.id, ctx.competitionId))
      .run();
    ctx.handle.sqlite
      .prepare(`INSERT INTO config (key, value) VALUES ('EVENTOR_API_KEY', 'KEY')`)
      .run();
    const mk = (name: string, classKind?: 'oppen') => {
      const id = crypto.randomUUID();
      ctx.handle.db
        .insert(classes)
        .values({
          id,
          competitionId: ctx.competitionId,
          name,
          ...(classKind ? { classKind, classKindSource: 'operator' as const } : {}),
        })
        .run();
      return id;
    };
    const h21 = mk('H21 Kort');
    const mine = mk('D21 Kort', 'oppen');
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          '<EventClassList><EventClass><Name>H21 Kort</Name><ClassTypeId>17</ClassTypeId></EventClass>' +
            '<EventClass><Name>D21 Kort</Name><ClassTypeId>17</ClassTypeId></EventClass></EventClassList>',
          { status: 200 }
        )
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/classes/kinds/from-eventor`,
    });
    assert.equal(res.statusCode, 200, res.body);
    const row = (id: string) =>
      ctx.handle.db.select().from(classes).where(eq(classes.id, id)).get()!;
    assert.deepEqual(
      [row(h21).classKind, row(h21).ageClass, row(h21).classKindSource],
      ['senior', 21, 'eventor']
    );
    assert.deepEqual([row(mine).classKind, row(mine).classKindSource], ['oppen', 'operator']);
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
