// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the competitions REST CRUD. Exercises the full Zod
// + Drizzle + Fastify boundary the SvelteKit wizard (plan 12) consumes:
//
//   - POST 201 + persistence
//   - POST 400 on Zod failure (missing required fields)
//   - GET :id with embedded classes + courses (initially both empty)
//   - GET :id 404 on unknown id
//   - PATCH :id flips auto_print and the next GET reflects it
//   - POST with malformed ISO date — regex catches structural failures
//     ('2026-13-99' is structurally valid but semantically invalid; the
//     regex pattern accepts it by design, documented in dtos.ts)
//   - PATCH with empty body returns 200 (idempotent no-op)
//
// All requests use app.inject() (PATTERNS S-7) — no real listener, no ports
// consumed. dbHandle is in-memory per test (PATTERNS S-2).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 1

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
  return { app, handle };
}

describe('competitions REST CRUD', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: POST /api/competitions with valid body returns 201; row persisted', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'StorTuna Tuesday', date: '2026-05-19' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as {
      id: string;
      name: string;
      date: string;
      receipt_template: string;
      auto_print: boolean;
      created_at_ms: number;
    };
    assert.equal(body.name, 'StorTuna Tuesday');
    assert.equal(body.date, '2026-05-19');
    assert.equal(body.receipt_template, 'classic');
    assert.equal(body.auto_print, false);
    assert.ok(/^[0-9a-fA-F-]{36}$/.test(body.id));
    assert.ok(body.created_at_ms > 0);

    // Verify it was persisted: GET /api/competitions includes it.
    const listRes = await ctx.app.inject({ method: 'GET', url: '/api/competitions' });
    assert.equal(listRes.statusCode, 200);
    const list = listRes.json() as { competitions: { id: string }[] };
    assert.ok(list.competitions.some((c) => c.id === body.id));
  });

  test('test 2: POST without required fields returns 400 with errors array', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'no-date' },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { errors: { path: string; code: string; message: string }[] };
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.length > 0);
    assert.ok(body.errors.some((e) => e.path === 'date'));
  });

  test('test 3: GET /api/competitions/:id returns 200 with empty classes + courses arrays', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Wednesday', date: '2026-05-20' },
    });
    const { id } = createRes.json() as { id: string };

    const getRes = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${id}` });
    assert.equal(getRes.statusCode, 200);
    const body = getRes.json() as {
      competition: { id: string; name: string };
      classes: unknown[];
      courses: unknown[];
    };
    assert.equal(body.competition.id, id);
    assert.equal(body.competition.name, 'Wednesday');
    assert.deepEqual(body.classes, []);
    assert.deepEqual(body.courses, []);
  });

  test('test 4: GET /api/competitions/:id with unknown id returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000',
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 5: PATCH /api/competitions/:id sets auto_print: true; subsequent GET reflects it', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Patchable', date: '2026-05-21' },
    });
    const { id } = createRes.json() as { id: string; auto_print: boolean };

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}`,
      payload: { auto_print: true },
    });
    assert.equal(patchRes.statusCode, 200);
    const patched = patchRes.json() as { auto_print: boolean };
    assert.equal(patched.auto_print, true);

    const getRes = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${id}` });
    const detail = getRes.json() as { competition: { auto_print: boolean } };
    assert.equal(detail.competition.auto_print, true);
  });

  test('test 6 (D-15 date format): POST with malformed date returns 400', async () => {
    // The regex ^\d{4}-\d{2}-\d{2}$ catches structural failures (wrong
    // number of digits, missing separators). It does NOT validate semantic
    // month/day — '2026-13-99' passes the regex by design (documented in
    // dtos.ts; SQLite doesn't validate either).
    const malformed = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'bad', date: '2026/05/22' },
    });
    assert.equal(malformed.statusCode, 400);
    const body = malformed.json() as { errors: { path: string }[] };
    assert.ok(body.errors.some((e) => e.path === 'date'));
  });

  test('test 7: PATCH with empty body returns 200 (idempotent no-op)', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'noop', date: '2026-05-22' },
    });
    const { id, name, auto_print } = createRes.json() as {
      id: string;
      name: string;
      auto_print: boolean;
    };

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}`,
      payload: {},
    });
    assert.equal(patchRes.statusCode, 200);
    const after = patchRes.json() as { id: string; name: string; auto_print: boolean };
    assert.equal(after.id, id);
    assert.equal(after.name, name);
    assert.equal(after.auto_print, auto_print);
  });

  test('test 8: list ordered by created_at_ms DESC', async () => {
    const a = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'A', date: '2026-05-22' },
    });
    // Small gap so timestamps differ — Date.now resolution is ms.
    await new Promise((r) => setTimeout(r, 5));
    const b = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'B', date: '2026-05-23' },
    });
    const idA = (a.json() as { id: string }).id;
    const idB = (b.json() as { id: string }).id;

    const listRes = await ctx.app.inject({ method: 'GET', url: '/api/competitions' });
    const list = (listRes.json() as { competitions: { id: string; created_at_ms: number }[] })
      .competitions;
    const idxA = list.findIndex((c) => c.id === idA);
    const idxB = list.findIndex((c) => c.id === idB);
    assert.ok(idxA >= 0 && idxB >= 0);
    assert.ok(idxB < idxA, 'B (newer) should sort before A (older) in DESC order');
  });

  test('test 9: PATCH with unknown id returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000',
      payload: { auto_print: true },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 10: PATCH with malformed receipt_template returns 400', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'X', date: '2026-05-22' },
    });
    const { id } = createRes.json() as { id: string };
    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}`,
      payload: { receipt_template: 'rainbow' },
    });
    assert.equal(patchRes.statusCode, 400);
  });

  // Phase 2.1 — race-phase gate.

  test('Phase 2.1: new competitions default to race_started_at_ms=null', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Pre-race comp', date: '2026-05-25' },
    });
    assert.equal(createRes.statusCode, 201);
    const body = createRes.json() as { race_started_at_ms: number | null };
    assert.equal(body.race_started_at_ms, null);
  });

  test('Phase 2.1: POST /start-race sets race_started_at_ms and returns 201', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Start-race test', date: '2026-05-26' },
    });
    const { id } = createRes.json() as { id: string };
    const before = Date.now();
    const startRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/start-race`,
      payload: {},
    });
    const after = Date.now();
    assert.equal(startRes.statusCode, 201);
    const body = startRes.json() as { race_started_at_ms: number | null };
    assert.ok(body.race_started_at_ms !== null);
    assert.ok(body.race_started_at_ms! >= before);
    assert.ok(body.race_started_at_ms! <= after);
  });

  test('Phase 2.1: POST /start-race on already-started competition is idempotent (returns existing ts)', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Idempotent start', date: '2026-05-26' },
    });
    const { id } = createRes.json() as { id: string };
    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/start-race`,
      payload: {},
    });
    const firstStamp = (first.json() as { race_started_at_ms: number }).race_started_at_ms;
    // Second call must NOT overwrite the timestamp — return 200 with the
    // existing stamp, no new event written.
    const second = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/start-race`,
      payload: {},
    });
    assert.equal(second.statusCode, 200);
    const secondStamp = (second.json() as { race_started_at_ms: number }).race_started_at_ms;
    assert.equal(secondStamp, firstStamp);
  });

  test('Phase 2.1: POST /start-race on unknown id returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000/start-race',
      payload: {},
    });
    assert.equal(res.statusCode, 404);
  });

  test('Phase 2.1: POST /reset-race clears race_started_at_ms and returns 201', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Reset comp', date: '2026-05-27' },
    });
    const { id } = createRes.json() as { id: string };
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/start-race`,
      payload: {},
    });
    const resetRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/reset-race`,
      payload: {},
    });
    assert.equal(resetRes.statusCode, 201);
    const body = resetRes.json() as { race_started_at_ms: number | null };
    assert.equal(body.race_started_at_ms, null);
  });

  test('Phase 2.1: POST /reset-race on already-pre-race competition is idempotent (200, no new event)', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Reset idem', date: '2026-05-28' },
    });
    const { id } = createRes.json() as { id: string };
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/reset-race`,
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { race_started_at_ms: number | null };
    assert.equal(body.race_started_at_ms, null);
  });

  test('Phase 2.1: POST /reset-race on unknown id returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000/reset-race',
      payload: {},
    });
    assert.equal(res.statusCode, 404);
  });

  // Plan 02.1-11 — eventor_event_id linkage

  test('Plan 11: POST /api/competitions with eventor_event_id stores and echoes it', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Eventor Linked', date: '2026-06-01', eventor_event_id: 42001 },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { id: string; eventor_event_id: number | null };
    assert.equal(body.eventor_event_id, 42001);

    // GET should also return it.
    const getRes = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${body.id}` });
    const detail = getRes.json() as { competition: { eventor_event_id: number | null } };
    assert.equal(detail.competition.eventor_event_id, 42001);
  });

  test('Plan 11: POST /api/competitions without eventor_event_id returns null', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'No Eventor', date: '2026-06-02' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { eventor_event_id: number | null };
    assert.equal(body.eventor_event_id, null);
  });

  test('Plan 11: PATCH /api/competitions/:id with eventor_event_id links', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Patch Link', date: '2026-06-03' },
    });
    const { id } = createRes.json() as { id: string };

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}`,
      payload: { eventor_event_id: 55000 },
    });
    assert.equal(patchRes.statusCode, 200);
    const patched = patchRes.json() as { eventor_event_id: number | null };
    assert.equal(patched.eventor_event_id, 55000);
  });

  test('Plan 11: PATCH /api/competitions/:id with null eventor_event_id unlinks', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Unlink Test', date: '2026-06-04', eventor_event_id: 99001 },
    });
    const { id } = createRes.json() as { id: string };

    // Verify it's linked first.
    const linked = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${id}` });
    assert.equal(
      (linked.json() as { competition: { eventor_event_id: number | null } }).competition
        .eventor_event_id,
      99001
    );

    // Unlink via PATCH.
    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}`,
      payload: { eventor_event_id: null },
    });
    assert.equal(patchRes.statusCode, 200);
    const unlinked = patchRes.json() as { eventor_event_id: number | null };
    assert.equal(unlinked.eventor_event_id, null);
  });
});
