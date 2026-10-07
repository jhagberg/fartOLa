// Authored for fartola. Not ported from upstream.
//
// node:test coverage for `POST /api/competitions/:id/print-receipt`.
// PATTERNS S-2 — every test injects a recording PrinterSink via
// buildServer({ printerSink }), so the assertions can inspect the
// envelope that reached the sink without running real ESC/POS.
//
// Coverage:
//   1. Valid POST → 201; sink received an envelope with the resolved
//      competitor + competition + classObj + course; data.skogisStats is
//      UNDEFINED for non-kids templates.
//   2. POST with template='kids' → sink received an envelope whose
//      data.skogisStats is a SkogisStats object (fart/stig/kart/tur in
//      1..5). The route called skogisFromInput at construction time
//      (W-3 LOCKED — the template is a pure renderer).
//   3. Unknown competitor → 404.
//   4. Template omitted → defaults to competition.receipt_template
//      ('classic' on new competitions per plan 04).
//   5. Sink rejects 'printer_offline' → 503.
//   6. Sink rejects 'queue_full' → 429.
//
// Locked by 01-15-PLAN.md task 1.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { PrinterSink, PrintEnvelope } from '../print/sink.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  printed: PrintEnvelope[];
  /** Optional rejection injection: when set, the sink rejects with this
   * error message (for the 503/429 error-mapping tests). */
  rejectWith: { msg: string } | null;
}

function makeSink(ctx: Ctx): PrinterSink {
  return {
    async isPrinterConnected(): Promise<boolean> {
      return true;
    },
    async print(envelope: PrintEnvelope): Promise<void> {
      if (ctx.rejectWith) throw new Error(ctx.rejectWith.msg);
      ctx.printed.push(envelope);
    },
  };
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const ctx: Partial<Ctx> = { handle, printed: [], rejectWith: null };
  ctx.app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    printerSink: makeSink(ctx as Ctx),
    projectionDebounceMs: 0,
  });
  return ctx as Ctx;
}

/** Seed a competition + class + competitor via REST so the routes
 * exercise the same validation path the integration covers. */
async function seed(
  app: FastifyInstance
): Promise<{ competitionId: string; classId: string; competitorId: string }> {
  const compRes = await app.inject({
    method: 'POST',
    url: '/api/competitions',
    payload: { name: 'TestRcpt', date: '2026-05-22' },
  });
  const competitionId = (compRes.json() as { id: string }).id;
  const classRes = await app.inject({
    method: 'POST',
    url: `/api/competitions/${competitionId}/classes`,
    payload: { name: 'H21' },
  });
  const classId = (classRes.json() as { id: string }).id;
  const competitorRes = await app.inject({
    method: 'POST',
    url: '/api/competitors',
    payload: {
      competition_id: competitionId,
      name: 'Anna Andersson',
      club: 'OK Test',
      class_id: classId,
      card_number: 7501853,
      consent: true,
    },
  });
  const competitorId = (competitorRes.json() as { id: string }).id;
  return { competitionId, classId, competitorId };
}

describe('POST /api/competitions/:id/print-receipt (plan 15 Task 1)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: valid POST → 201; envelope has resolved competitor + competition + class; no skogisStats for non-kids', async () => {
    const { competitionId, competitorId } = await seed(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId, template: 'classic' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { queued: boolean };
    assert.equal(body.queued, true);
    assert.equal(ctx.printed.length, 1);
    const envelope = ctx.printed[0]!;
    assert.equal(envelope.template, 'classic');
    assert.equal(envelope.competition_id, competitionId);
    assert.equal(envelope.card_number, 7501853);
    const data = envelope.data as {
      competitor: { id: string; name: string };
      competition: { name: string };
      classObj: { name: string };
      skogisStats?: unknown;
    };
    assert.equal(data.competitor.id, competitorId);
    assert.equal(data.competitor.name, 'Anna Andersson');
    assert.equal(data.competition.name, 'TestRcpt');
    assert.equal(data.classObj.name, 'H21');
    assert.equal(data.skogisStats, undefined, 'non-kids template must not carry skogisStats');
  });

  test('test 8 (02.1-14 Task 4): course comes from classes.course_id when another class owns courses.class_id', async () => {
    const { competitionId, classId, competitorId } = await seed(ctx.app);
    const otherRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/classes`,
      payload: { name: 'D21' },
    });
    const otherClassId = (otherRes.json() as { id: string }).id;
    const courseRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/courses`,
      payload: {
        name: 'Bana 1',
        class_id: otherClassId,
        controls: [{ control_code: 31, order_idx: 0 }],
      },
    });
    const courseId = (courseRes.json() as { id: string }).id;
    ctx.handle.sqlite
      .prepare('UPDATE classes SET course_id = ? WHERE id = ?')
      .run(courseId, classId);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId, template: 'classic' },
    });
    assert.equal(res.statusCode, 201, res.body);
    const data = ctx.printed[0]!.data as { course: { id: string; control_codes: number[] } | null };
    assert.equal(data.course?.id, courseId);
    assert.deepEqual(data.course?.control_codes, [31]);
  });

  test('test 2 (W-3): template=kids → envelope.data.skogisStats populated at construction site', async () => {
    const { competitionId, competitorId } = await seed(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId, template: 'kids' },
    });
    assert.equal(res.statusCode, 201);
    const envelope = ctx.printed[0]!;
    assert.equal(envelope.template, 'kids');
    const data = envelope.data as {
      skogisStats?: { fart: number; stig: number; kart: number; tur: number };
    };
    assert.ok(data.skogisStats, 'kids envelope must carry skogisStats');
    for (const k of ['fart', 'stig', 'kart', 'tur'] as const) {
      const v: number = data.skogisStats[k];
      assert.ok(typeof v === 'number' && v >= 1 && v <= 5, `${k}=${v} must be in 1..5`);
    }
  });

  test('test 3: unknown competitor → 404', async () => {
    const { competitionId } = await seed(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: 'nope', template: 'classic' },
    });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { error: string }).error, 'competitor_not_found');
    assert.equal(ctx.printed.length, 0);
  });

  test('test 4: template omitted → defaults to competition.receipt_template', async () => {
    const { competitionId, competitorId } = await seed(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId },
    });
    assert.equal(res.statusCode, 201);
    // Plan 04 default is 'classic'.
    assert.equal(ctx.printed[0]!.template, 'classic');
  });

  test('test 5: sink rejects printer_offline → 503', async () => {
    const { competitionId, competitorId } = await seed(ctx.app);
    ctx.rejectWith = { msg: 'printer_offline' };
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId, template: 'classic' },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'printer_offline');
  });

  test('test 6: sink rejects queue_full → 429', async () => {
    const { competitionId, competitorId } = await seed(ctx.app);
    ctx.rejectWith = { msg: 'queue_full' };
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/print-receipt`,
      payload: { competitor_id: competitorId, template: 'classic' },
    });
    assert.equal(res.statusCode, 429);
    assert.equal((res.json() as { error: string }).error, 'queue_full');
  });

  test('test 7: unknown competition → 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/no-such-comp/print-receipt',
      payload: { competitor_id: 'whatever', template: 'classic' },
    });
    assert.equal(res.statusCode, 404);
  });
});
