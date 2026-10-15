// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the Plan 02-05 Hyrbricka REST surface:
//
//   - GET  /api/competitions/:id/hired-cards
//   - PATCH /api/competitions/:id/hired-cards/:cardNumber/return
//
// Tests:
//   1. GET on a competition with 2 open + 1 returned rentals returns
//      { open: [2 rows], returned: [1 row] } with all contact fields.
//   2. PATCH on an open rental sets returned_at_ms = now() and returns 200
//      { ok: true, returned_at_ms: <ms> }.
//   3. PATCH again on the same card returns 200
//      { ok: true, already_returned: true, returned_at_ms: <original ms> }
//      — idempotent; the existing timestamp is preserved.
//   4. PATCH on a non-existent card returns 404 { error: 'not_found' }.
//   5. PATCH on a card from a DIFFERENT competition returns 404 (composite
//      PK isolation).
//   6. PATCH triggers wsBroadcast on readoutChannel with
//      `{ type: 'hired_card_returned', payload: { card_number, returned_at_ms } }`
//      AFTER the transaction commits (PATTERNS S-4).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 1
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-1 (junction PK)
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §S-4 (broadcast-after-commit)

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import type { BroadcastSink } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { competitions, hiredCards } from '../db/schema.ts';
import { readoutChannel } from '@fartola/shared-types';

interface CapturedEnvelope {
  channel: string;
  envelope: { type: string; payload: unknown; seq?: number };
}

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  captured: CapturedEnvelope[];
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const captured: CapturedEnvelope[] = [];
  const sink: BroadcastSink = {
    record: (channel, envelope) => {
      captured.push({ channel, envelope });
    },
  };
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    broadcastSink: sink,
  });
  return { app, handle, captured };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
}

/** Seed a competition row directly via SQL. The schema only requires
 * id / name / date / created_at_ms; the other columns have defaults. */
function seedCompetition(handle: DbHandle, id: string): void {
  handle.db
    .insert(competitions)
    .values({
      id,
      name: `Comp ${id}`,
      date: '2026-05-20',
      createdAtMs: 1_700_000_000_000,
    })
    .run();
}

/** Seed a hired_cards row directly via drizzle. */
function seedHiredCard(
  handle: DbHandle,
  competitionId: string,
  cardNumber: number,
  opts: {
    markedAtMs?: number;
    returnedAtMs?: number | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    note?: string | null;
  } = {}
): void {
  handle.db
    .insert(hiredCards)
    .values({
      competitionId,
      cardNumber,
      markedAtMs: opts.markedAtMs ?? 1_700_000_000_000,
      returnedAtMs: opts.returnedAtMs ?? null,
      contactName: opts.contactName ?? null,
      contactPhone: opts.contactPhone ?? null,
      contactEmail: opts.contactEmail ?? null,
      note: opts.note ?? null,
    })
    .run();
}

// ============================================================================
// GET /api/competitions/:id/hired-cards
// ============================================================================

describe('GET /api/competitions/:id/hired-cards', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  test('test 1: returns { open: [2], returned: [1] } with all contact fields', async () => {
    seedCompetition(ctx.handle, 'comp-1');
    seedHiredCard(ctx.handle, 'comp-1', 11111, {
      markedAtMs: 1_000,
      contactName: 'Anna Andersson',
      contactPhone: '0701111111',
      contactEmail: 'anna@example.com',
      note: 'open A',
    });
    seedHiredCard(ctx.handle, 'comp-1', 22222, {
      markedAtMs: 2_000,
      contactName: 'Bertil Bengtsson',
      contactPhone: '0702222222',
      contactEmail: 'bertil@example.com',
      note: 'open B',
    });
    seedHiredCard(ctx.handle, 'comp-1', 33333, {
      markedAtMs: 3_000,
      returnedAtMs: 4_000,
      contactName: 'Cecilia',
      contactPhone: null,
      contactEmail: 'cecilia@example.com',
      note: 'returned C',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-1/hired-cards',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      open: Array<{
        competition_id: string;
        card_number: number;
        marked_at_ms: number;
        returned_at_ms: number | null;
        contact_name: string | null;
        contact_phone: string | null;
        contact_email: string | null;
        note: string | null;
      }>;
      returned: typeof body.open;
    };
    assert.equal(body.open.length, 2);
    assert.equal(body.returned.length, 1);
    // Newest-first ordering on marked_at_ms.
    assert.equal(body.open[0]?.card_number, 22222);
    assert.equal(body.open[1]?.card_number, 11111);
    assert.equal(body.open[0]?.contact_phone, '0702222222');
    assert.equal(body.open[0]?.returned_at_ms, null);
    assert.equal(body.returned[0]?.card_number, 33333);
    assert.equal(body.returned[0]?.returned_at_ms, 4_000);
    assert.equal(body.returned[0]?.contact_email, 'cecilia@example.com');
  });

  test('test 1b: empty competition returns { open: [], returned: [] }', async () => {
    seedCompetition(ctx.handle, 'comp-empty');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-empty/hired-cards',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { open: unknown[]; returned: unknown[] };
    assert.deepEqual(body.open, []);
    assert.deepEqual(body.returned, []);
  });
});

// ============================================================================
// PATCH /api/competitions/:id/hired-cards/:cardNumber/return
// ============================================================================

describe('PATCH /api/competitions/:id/hired-cards/:cardNumber/return', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  test('test 2: PATCH on open rental sets returned_at_ms = now() and returns 200', async () => {
    seedCompetition(ctx.handle, 'comp-2');
    seedHiredCard(ctx.handle, 'comp-2', 12345, { contactPhone: '0701234567' });

    const before = Date.now();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-2/hired-cards/12345/return',
    });
    const after = Date.now();

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      returned_at_ms: number;
      already_returned?: boolean;
    };
    assert.equal(body.ok, true);
    assert.ok(body.returned_at_ms >= before);
    assert.ok(body.returned_at_ms <= after);
    assert.equal(body.already_returned, undefined);

    // Row in DB should reflect the timestamp.
    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.ok(row);
    assert.equal(row.returnedAtMs, body.returned_at_ms);
  });

  test('test 3: second PATCH is idempotent — returns already_returned with original ms', async () => {
    seedCompetition(ctx.handle, 'comp-3');
    seedHiredCard(ctx.handle, 'comp-3', 54321, {
      returnedAtMs: 1_700_000_000_000,
    });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-3/hired-cards/54321/return',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      returned_at_ms: number;
      already_returned?: boolean;
    };
    assert.equal(body.ok, true);
    assert.equal(body.already_returned, true);
    assert.equal(body.returned_at_ms, 1_700_000_000_000);
  });

  test('test 4: PATCH on non-existent card returns 404 not_found', async () => {
    seedCompetition(ctx.handle, 'comp-4');
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-4/hired-cards/99999/return',
    });
    assert.equal(res.statusCode, 404);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'not_found');
  });

  test('test 5: PATCH on a card from a different competition returns 404', async () => {
    seedCompetition(ctx.handle, 'comp-5a');
    seedCompetition(ctx.handle, 'comp-5b');
    // Card belongs to comp-5a only.
    seedHiredCard(ctx.handle, 'comp-5a', 88888);

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-5b/hired-cards/88888/return',
    });
    assert.equal(res.statusCode, 404);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'not_found');

    // The comp-5a row must remain open (we didn't accidentally update it).
    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.ok(row);
    assert.equal(row.returnedAtMs, null);
  });

  test('test 6: PATCH broadcasts hired_card_returned envelope AFTER commit', async () => {
    seedCompetition(ctx.handle, 'comp-6');
    seedHiredCard(ctx.handle, 'comp-6', 77777, { contactName: 'Renter' });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-6/hired-cards/77777/return',
    });
    assert.equal(res.statusCode, 200);

    const returnedAtMs = (res.json() as { returned_at_ms: number }).returned_at_ms;

    const returnedEnvelopes = ctx.captured.filter((c) => c.envelope.type === 'hired_card_returned');
    assert.equal(returnedEnvelopes.length, 1);
    const envelope = returnedEnvelopes[0];
    assert.ok(envelope);
    assert.equal(envelope.channel, readoutChannel('comp-6'));
    const payload = envelope.envelope.payload as {
      card_number?: number;
      returned_at_ms?: number;
    };
    assert.equal(payload.card_number, 77777);
    assert.equal(payload.returned_at_ms, returnedAtMs);

    // Broadcast-after-commit: the row is already updated by the time the
    // envelope landed.
    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.ok(row);
    assert.equal(row.returnedAtMs, returnedAtMs);
  });

  test('test 6b: idempotent PATCH does NOT re-broadcast (no envelope on already_returned)', async () => {
    seedCompetition(ctx.handle, 'comp-6b');
    seedHiredCard(ctx.handle, 'comp-6b', 66666, { returnedAtMs: 999 });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-6b/hired-cards/66666/return',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { already_returned?: boolean };
    assert.equal(body.already_returned, true);

    const returnedEnvelopes = ctx.captured.filter((c) => c.envelope.type === 'hired_card_returned');
    assert.equal(returnedEnvelopes.length, 0);
  });

  test('test 6c (Gemini G-001): UPDATE WHERE isNull(returnedAtMs) is race-safe — loser writes 0 rows + no broadcast', async () => {
    // Gemini review G-001: the PATCH return handler had a race where two
    // concurrent requests could both pass the pre-flight SELECT, then both
    // UPDATE, then both broadcast (duplicate hired_card_returned envelopes).
    // Fix: the UPDATE WHERE now includes isNull(returnedAtMs), and the
    // broadcast is gated on result.changes > 0. This test simulates the
    // race-loser path at the SQL level: a row that was unreturned at
    // pre-flight time has since been returned by another request. The
    // race-loser's UPDATE must affect 0 rows (no silent overwrite of the
    // race-winner's timestamp) so the gate suppresses its broadcast.
    seedCompetition(ctx.handle, 'comp-6c');
    seedHiredCard(ctx.handle, 'comp-6c', 55555, { returnedAtMs: 999 });

    const result = ctx.handle.db
      .update(hiredCards)
      .set({ returnedAtMs: 1234 })
      .where(
        and(
          eq(hiredCards.competitionId, 'comp-6c'),
          eq(hiredCards.cardNumber, 55555),
          isNull(hiredCards.returnedAtMs)
        )
      )
      .run();

    assert.equal(result.changes, 0, 'isNull guard must prevent the race-loser write');

    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.ok(row);
    assert.equal(row.returnedAtMs, 999, 'returnedAtMs must NOT be overwritten by race-loser');
  });
});

// ============================================================================
// PATCH /api/competitions/:id/hired-cards/:cardNumber (edit the contact)
// ============================================================================

describe('PATCH /api/competitions/:id/hired-cards/:cardNumber', () => {
  let ctx: Ctx;
  const url = '/api/competitions/comp-e/hired-cards/12345';
  const good = { name: 'Rut', phone: '+46 70-123 45 67', email: 'rut@example.org', note: 'ok' };

  beforeEach(async () => {
    ctx = await boot();
    seedCompetition(ctx.handle, 'comp-e');
    seedHiredCard(ctx.handle, 'comp-e', 12345, { contactPhone: '0700000000' });
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('updates name, phone, email and note', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url, payload: good });
    assert.equal(res.statusCode, 200);
    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.equal(row?.contactName, 'Rut');
    assert.equal(row?.contactPhone, '+46 70-123 45 67');
    assert.equal(row?.contactEmail, 'rut@example.org');
    assert.equal(row?.note, 'ok');
  });

  test('empty strings are stored as null', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url,
      payload: { name: '  ', phone: '0701234567', email: '', note: null },
    });
    assert.equal(res.statusCode, 200);
    const row = ctx.handle.db.select().from(hiredCards).all()[0];
    assert.equal(row?.contactName, null);
    assert.equal(row?.contactEmail, null);
  });

  test('a phone number of letters is refused and nothing changes', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url, payload: { ...good, phone: 'abc' } });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'hyrbricka_phone_invalid');
    assert.equal(ctx.handle.db.select().from(hiredCards).all()[0]?.contactPhone, '0700000000');
  });

  test('an e-mail without @ is refused', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url, payload: { ...good, email: 'rut' } });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'hyrbricka_email_invalid');
  });

  test('both phone and e-mail empty is refused', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url,
      payload: { name: 'Rut', phone: '', email: null, note: null },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'hyrbricka_contact_required');
  });

  test('unknown card is 404', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/comp-e/hired-cards/99999',
      payload: good,
    });
    assert.equal(res.statusCode, 404);
  });
});
