// Authored for fartola. Not ported from upstream.
//
// node:test coverage for /api/competitors (walk-up registration) + /api/clubs
// autocomplete. Exercises:
//
//   - test 1: POST valid body w/ card_number + club → 201; competitor row +
//     clubs upsert + events row (card_bound) all present.
//   - test 2: POST same card_number twice → 409 'card_taken'.
//   - test 3 (REQ-PRIV-001): POST without consent → 400 with errors path 'consent'.
//   - test 4: POST with consent: false → 400.
//   - test 5 (T-CLASS-COMP-MISMATCH): POST with class_id from a different
//     competition → 422.
//   - test 6: POST w/o card_number (pre-entry walk-up A) → 201, no card_bound
//     event, competitor.card_number IS NULL.
//   - test 7 (broadcast spy): after successful POST w/ card_number, the
//     BroadcastSink recorded one envelope on readout:<comp> with
//     type='card_bound' (PATTERNS S-2 — no real WS client).
//   - test 8 (GET /api/clubs): three clubs inserted with different
//     last_seen_at_ms; GET returns them DESC ordered.
//   - test 9 (atomicity): app.fartolaNextLocalSeq is swapped to a throwing fn;
//     POST fails 500, competitor row + clubs row + events row all absent
//     (rollback).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildServer, type BroadcastSink } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { competitors, events, clubs as clubsTable } from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { ChannelName } from '@fartola/shared-types';
import { eq } from 'drizzle-orm';
import { localToEpochMs } from '../time/competitionClock.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  recorded: { channel: ChannelName; envelope: { type: string; payload: unknown; seq?: number } }[];
}

async function boot(extra?: {
  nextLocalSeqFn?: (handle: DbHandle, nodeId: string) => number;
}): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const recorded: Ctx['recorded'] = [];
  const broadcastSink: BroadcastSink = {
    record: (channel, envelope) => {
      recorded.push({ channel, envelope });
    },
  };
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    broadcastSink,
    ...(extra?.nextLocalSeqFn ? { nextLocalSeqFn: extra.nextLocalSeqFn } : {}),
  });
  return { app, handle, recorded };
}

async function seedCompetitionAndClass(
  app: FastifyInstance
): Promise<{ competitionId: string; classId: string }> {
  const compRes = await app.inject({
    method: 'POST',
    url: '/api/competitions',
    payload: { name: 'Wk', date: '2026-05-22' },
  });
  const competitionId = (compRes.json() as { id: string }).id;
  const classRes = await app.inject({
    method: 'POST',
    url: `/api/competitions/${competitionId}/classes`,
    payload: { name: 'H21' },
  });
  const classId = (classRes.json() as { id: string }).id;
  return { competitionId, classId };
}

describe('competitors walk-up registration', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: valid POST w/ card + club returns 201; competitor + clubs upsert + card_bound event persisted', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Jonas Hagberg',
        club: 'StorTuna IF',
        class_id: classId,
        card_number: 7501853,
        consent: true,
      },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as {
      id: string;
      name: string;
      consent_at_ms: number;
      consent_status: string;
    };
    assert.equal(body.name, 'Jonas Hagberg');
    assert.equal(body.consent_status, 'explicit');
    assert.ok(body.consent_at_ms > 0);

    // Competitor row persisted.
    const compRow = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, body.id))
      .get();
    assert.ok(compRow);
    assert.equal(compRow.cardNumber, 7501853);
    assert.equal(compRow.club, 'StorTuna IF');

    // Clubs upserted.
    const clubRow = ctx.handle.db
      .select()
      .from(clubsTable)
      .where(eq(clubsTable.name, 'StorTuna IF'))
      .get();
    assert.ok(clubRow);

    // Card_bound event inserted.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.equal(evtRows.length, 1);
    assert.equal(evtRows[0]?.eventType, 'card_bound');
  });

  test('test 2: same card_number for same competition twice → second is 409 card_taken', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const payload = {
      competition_id: competitionId,
      name: 'Alice',
      club: null,
      class_id: classId,
      card_number: 1234567,
      consent: true,
    };
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload,
    });
    assert.equal(first.statusCode, 201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { ...payload, name: 'Bob' },
    });
    assert.equal(second.statusCode, 409);
    const body = second.json() as { error: string; existing_competitor_id: string };
    assert.equal(body.error, 'card_taken');
    assert.equal(body.existing_competitor_id, (first.json() as { id: string }).id);
  });

  test('test 3 (REQ-PRIV-001): POST without consent → 400 with path "consent"', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Test',
        class_id: classId,
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { errors: { path: string }[] };
    assert.ok(body.errors.some((e) => e.path === 'consent'));
  });

  test('SOFT TR 4.14.4: a walk-up entry stores the consent (explicit, with its time)', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const before = Date.now();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { competition_id: competitionId, name: 'Vera', class_id: classId, consent: true },
    });
    const after = Date.now();
    assert.equal(res.statusCode, 201);
    const row = ctx.handle.db
      .select({ at: competitors.consentAtMs, status: competitors.consentStatus })
      .from(competitors)
      .where(eq(competitors.id, (res.json() as { id: string }).id))
      .get();
    assert.equal(row?.status, 'explicit');
    assert.ok(
      row?.at !== null && row!.at! >= before && row!.at! <= after,
      `consentAtMs ${row?.at}`
    );
  });

  test('SOFT TR 7.5.1: a walk-up entry without a name is rejected (empty or whitespace → 400)', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    for (const name of ['', '   ', undefined]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: { competition_id: competitionId, name, class_id: classId, consent: true },
      });
      assert.equal(res.statusCode, 400, JSON.stringify(name));
    }
    assert.equal(ctx.handle.db.select().from(competitors).all().length, 0);
  });

  test('test 4: POST with consent: false → 400', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Test',
        class_id: classId,
        consent: false,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 5 (T-CLASS-COMP-MISMATCH): class_id from a DIFFERENT competition → 422', async () => {
    const a = await seedCompetitionAndClass(ctx.app);
    const b = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: a.competitionId,
        name: 'Mismatched',
        class_id: b.classId, // class belongs to comp b, not a
        consent: true,
      },
    });
    assert.equal(res.statusCode, 422);
  });

  test('test 6: POST w/o card_number (walk-up scenario A) → 201, no card_bound event', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'No-card',
        class_id: classId,
        consent: true,
      },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { card_number: number | null };
    assert.equal(body.card_number, null);

    // No events row inserted.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.equal(evtRows.length, 0);
  });

  test('test 7 (PATTERNS S-2 broadcast spy): card_bound envelope recorded on readout:<comp>', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Broadcast Test',
        club: null,
        class_id: classId,
        card_number: 9999999,
        consent: true,
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(ctx.recorded.length, 1);
    const rec = ctx.recorded[0];
    assert.ok(rec);
    assert.equal(rec.channel, `readout:${competitionId}`);
    assert.equal(rec.envelope.type, 'card_bound');
    assert.ok(rec.envelope.seq !== undefined && rec.envelope.seq > 0);
  });

  test('test 7b: card_bound NOT broadcast when card_number is null', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'No-broadcast',
        class_id: classId,
        consent: true,
      },
    });
    assert.equal(ctx.recorded.length, 0);
  });
});

describe('competitors replace-card-for-competitor (plan 10)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 10: replace card_number for an existing competitor → 200; row UPDATEd; card_bound event emitted; consent_at_ms preserved', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    // Create competitor with initial card_number 1111111.
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Misread Magnus',
        club: null,
        class_id: classId,
        card_number: 1111111,
        consent: true,
      },
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json() as { id: string; consent_at_ms: number };
    const originalConsentAtMs = created.consent_at_ms;
    assert.ok(originalConsentAtMs > 0);

    // Replace card_number with 2222222 — the operator-corrected value.
    const replaceRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 2222222,
        replace_card_for_competitor_id: created.id,
      },
    });
    assert.equal(replaceRes.statusCode, 200);
    const body = replaceRes.json() as {
      id: string;
      card_number: number;
      consent_at_ms: number;
      name: string;
    };
    assert.equal(body.id, created.id);
    assert.equal(body.card_number, 2222222);
    assert.equal(body.name, 'Misread Magnus');
    // REQ-PRIV-001: consent_at_ms is preserved across the replace.
    assert.equal(body.consent_at_ms, originalConsentAtMs);

    // DB row reflects the new card_number; consent_at_ms unchanged.
    const compRow = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, created.id))
      .get();
    assert.ok(compRow);
    assert.equal(compRow.cardNumber, 2222222);
    assert.equal(compRow.consentAtMs, originalConsentAtMs);

    // Two card_bound events now exist for this competitor — the original
    // create event and the replace event. The latest one carries the new
    // card_number and the ORIGINAL consent_at_ms in payload.
    const cardBoundRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all()
      .filter((e) => e.eventType === 'card_bound');
    assert.equal(cardBoundRows.length, 2);
    const latest = cardBoundRows.sort((a, b) => b.localSeq - a.localSeq)[0];
    assert.ok(latest);
    const payload = latest.payload as {
      event_type: string;
      competitor_id: string;
      card_number: number;
      walkup: boolean;
      consent_at_ms: number;
    };
    assert.equal(payload.competitor_id, created.id);
    assert.equal(payload.card_number, 2222222);
    assert.equal(payload.walkup, true);
    assert.equal(payload.consent_at_ms, originalConsentAtMs);
  });

  test('test 11 (T-CROSS-COMP-REPLACE): replace target in a DIFFERENT competition → 404', async () => {
    const a = await seedCompetitionAndClass(ctx.app);
    const b = await seedCompetitionAndClass(ctx.app);
    // Create competitor in competition b.
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: b.competitionId,
        name: 'In B',
        club: null,
        class_id: b.classId,
        card_number: 3333333,
        consent: true,
      },
    });
    const competitorIdInB = (createRes.json() as { id: string }).id;

    // Try to replace it via competition a — must 404 even though the
    // competitor exists in competition b.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: a.competitionId,
        card_number: 4444444,
        replace_card_for_competitor_id: competitorIdInB,
      },
    });
    assert.equal(res.statusCode, 404);
    // The competitor's card_number in competition b is unchanged.
    const compRow = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorIdInB))
      .get();
    assert.equal(compRow?.cardNumber, 3333333);
  });

  test('test 12: replace with a card_number already taken by a DIFFERENT competitor in the same competition → 409', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    // Two competitors with different cards.
    const alice = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Alice',
        club: null,
        class_id: classId,
        card_number: 5555555,
        consent: true,
      },
    });
    const bob = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Bob',
        club: null,
        class_id: classId,
        card_number: 6666666,
        consent: true,
      },
    });
    const aliceId = (alice.json() as { id: string }).id;
    const bobId = (bob.json() as { id: string }).id;

    // Try to replace Alice's card_number with Bob's existing one → 409.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 6666666,
        replace_card_for_competitor_id: aliceId,
      },
    });
    assert.equal(res.statusCode, 409);
    const body = res.json() as { error: string; existing_competitor_id: string };
    assert.equal(body.error, 'card_taken');
    assert.equal(body.existing_competitor_id, bobId);

    // Alice's card unchanged.
    const aliceRow = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, aliceId))
      .get();
    assert.equal(aliceRow?.cardNumber, 5555555);
  });

  test('replace logs the old card in the card_bound event and returns the event for undo', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Entered Eva',
        club: null,
        class_id: classId,
        card_number: 1111111,
        consent: true,
      },
    });
    const evaId = (created.json() as { id: string }).id;

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 2222222,
        replace_card_for_competitor_id: evaId,
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      card_number: number;
      card_event: { node_id: string; local_seq: number; previous_card_number: number | null };
    };
    assert.equal(body.card_number, 2222222);
    assert.equal(body.card_event.previous_card_number, 1111111);

    const ev = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.localSeq, body.card_event.local_seq))
      .get();
    assert.ok(ev);
    assert.equal(ev.nodeId, body.card_event.node_id);
    const payload = ev.payload as { card_number: number; previous_card_number: number | null };
    assert.equal(payload.card_number, 2222222);
    assert.equal(payload.previous_card_number, 1111111);
  });

  test('replace with hired_card marks the new card hired; without contact → 400 and nothing changes', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Rental Rut',
        club: null,
        class_id: classId,
        card_number: null,
        consent: true,
      },
    });
    const rutId = (created.json() as { id: string }).id;

    const noContact = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 3333333,
        replace_card_for_competitor_id: rutId,
        hired_card: true,
        hired_contact: { name: null, phone: '', email: '', note: null },
      },
    });
    assert.equal(noContact.statusCode, 400);
    assert.equal((noContact.json() as { error: string }).error, 'hyrbricka_contact_required');
    const unchanged = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, rutId))
      .get();
    assert.equal(unchanged?.cardNumber, null);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 3333333,
        replace_card_for_competitor_id: rutId,
        hired_card: true,
        hired_contact: { name: 'Rut', phone: '0701234567', email: null, note: null },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(
      (res.json() as { card_event: { previous_card_number: number | null } }).card_event
        .previous_card_number,
      null
    );
    const hired = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(hired.length, 1);
    assert.equal(hired[0]!.cardNumber, 3333333);
    assert.equal(hired[0]!.contactPhone, '0701234567');
    assert.equal(hired[0]!.returnedAtMs, null);
  });
});

describe('competitors atomicity', () => {
  // Standalone describe so we can pass a custom nextLocalSeqFn that throws.

  test('test 9: events insert failure rolls back competitor + clubs upsert', async () => {
    const ctx = await boot({
      nextLocalSeqFn: () => {
        throw new Error('forced atomicity failure');
      },
    });
    try {
      const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: {
          competition_id: competitionId,
          name: 'Atomicity',
          club: 'PhantomClub',
          class_id: classId,
          card_number: 5555555,
          consent: true,
        },
      });
      // Fastify converts the thrown error to a 500.
      assert.equal(res.statusCode, 500);

      // Competitor row NOT inserted (transaction rolled back).
      const compRows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, competitionId))
        .all();
      assert.equal(compRows.length, 0);

      // Clubs row NOT inserted (transaction rolled back).
      const clubRows = ctx.handle.db
        .select()
        .from(clubsTable)
        .where(eq(clubsTable.name, 'PhantomClub'))
        .all();
      assert.equal(clubRows.length, 0);

      // No events row inserted.
      const evtRows = ctx.handle.db
        .select()
        .from(events)
        .where(eq(events.competitionId, competitionId))
        .all();
      assert.equal(evtRows.length, 0);
    } finally {
      await ctx.app.close();
      ctx.handle.close();
    }
  });
});

describe('competitors consent confirmation PATCH (plan 14 / C-M4)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  // EntryList imports land rows with consent_status='pending_first_read'
  // + consent_at_ms=null. We seed via a raw INSERT (mirroring the path
  // in apps/edge/src/ingest/entryImport.ts) so the PATCH route sees the
  // same column shape it would in production.
  function seedPendingCompetitor(
    competitionId: string,
    classId: string,
    name: string = 'Anna Andersson',
    cardNumber: number | null = 7501853
  ): string {
    const id = crypto.randomUUID();
    ctx.handle.db
      .insert(competitors)
      .values({
        id,
        competitionId,
        name,
        club: 'StorTuna IF',
        classId,
        cardNumber,
        consentAtMs: null,
        consentStatus: 'pending_first_read',
        scrubbedAtMs: null,
      })
      .run();
    return id;
  }

  test('test 13: PATCH pending_first_read → confirmed_on_read; row updated + consent_confirmed event row written', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const competitorId = seedPendingCompetitor(competitionId, classId);

    const consentAtMs = 1_715_700_000_000;
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: consentAtMs },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; competitor_id: string };
    assert.equal(body.ok, true);
    assert.equal(body.competitor_id, competitorId);

    // Row reflects the flip.
    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .get();
    assert.ok(row);
    assert.equal(row.consentStatus, 'confirmed_on_read');
    assert.equal(row.consentAtMs, consentAtMs);

    // Exactly one consent_confirmed event row.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all()
      .filter((e) => e.eventType === 'consent_confirmed');
    assert.equal(evtRows.length, 1);
    const payload = evtRows[0]!.payload as {
      event_type: string;
      competitor_id: string;
      prior_consent_status: string;
    };
    assert.equal(payload.event_type, 'consent_confirmed');
    assert.equal(payload.competitor_id, competitorId);
    assert.equal(payload.prior_consent_status, 'pending_first_read');
  });

  test('test 14: PATCH on already-explicit competitor → 422 consent_not_pending', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    // Walk-up creates a row with consent_status='explicit'.
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Walked Up',
        class_id: classId,
        card_number: 8888888,
        consent: true,
      },
    });
    assert.equal(createRes.statusCode, 201);
    const competitorId = (createRes.json() as { id: string }).id;

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: Date.now() },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { error: string; current: string };
    assert.equal(body.error, 'consent_not_pending');
    assert.equal(body.current, 'explicit');
  });

  test('test 15: PATCH on already-confirmed competitor → 422 consent_not_pending', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const competitorId = seedPendingCompetitor(competitionId, classId);

    // First flip — succeeds.
    const r1 = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: 1_715_700_000_000 },
    });
    assert.equal(r1.statusCode, 200);

    // Second flip on the same competitor — already confirmed → 422.
    const r2 = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: 1_715_700_500_000 },
    });
    assert.equal(r2.statusCode, 422);
    const body = r2.json() as { error: string; current: string };
    assert.equal(body.error, 'consent_not_pending');
    assert.equal(body.current, 'confirmed_on_read');
  });

  test('test 16: PATCH non-existent competitor → 404 competitor_not_found', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${crypto.randomUUID()}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: Date.now() },
    });
    assert.equal(res.statusCode, 404);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'competitor_not_found');
  });

  test('test 17: PATCH with bad body shape → 400 with structured errors', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const competitorId = seedPendingCompetitor(competitionId, classId);

    // Wrong literal — only 'confirmed_on_read' is accepted.
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'explicit', consent_at_ms: Date.now() },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { errors: { path: string }[] };
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.path === 'consent_status'));

    // consent_at_ms must be a positive integer.
    const r2 = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}`,
      payload: { consent_status: 'confirmed_on_read', consent_at_ms: -1 },
    });
    assert.equal(r2.statusCode, 400);
  });
});

describe('clubs autocomplete (GET /api/clubs)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 8: three clubs inserted with different last_seen_at_ms; GET returns them DESC ordered', async () => {
    // Seed via raw insert so we control last_seen_at_ms exactly.
    ctx.handle.db
      .insert(clubsTable)
      .values([
        { name: 'Old', lastSeenAtMs: 1000 },
        { name: 'New', lastSeenAtMs: 3000 },
        { name: 'Middle', lastSeenAtMs: 2000 },
      ])
      .run();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/clubs' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { clubs: { name: string; last_seen_at_ms: number }[] };
    assert.equal(body.clubs.length, 3);
    assert.equal(body.clubs[0]?.name, 'New');
    assert.equal(body.clubs[1]?.name, 'Middle');
    assert.equal(body.clubs[2]?.name, 'Old');
  });

  test('test 8b: GET /api/clubs?prefix=St filters by name prefix', async () => {
    ctx.handle.db
      .insert(clubsTable)
      .values([
        { name: 'StorTuna IF', lastSeenAtMs: 1000 },
        { name: 'Stockholms OK', lastSeenAtMs: 2000 },
        { name: 'OK Linné', lastSeenAtMs: 3000 },
      ])
      .run();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/clubs?prefix=St' });
    const body = res.json() as { clubs: { name: string }[] };
    assert.equal(body.clubs.length, 2);
    assert.ok(body.clubs.every((c) => c.name.startsWith('St')));
  });

  test('test 8c: GET /api/clubs?limit=2 caps the result set', async () => {
    ctx.handle.db
      .insert(clubsTable)
      .values([
        { name: 'A', lastSeenAtMs: 1000 },
        { name: 'B', lastSeenAtMs: 2000 },
        { name: 'C', lastSeenAtMs: 3000 },
      ])
      .run();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/clubs?limit=2' });
    const body = res.json() as { clubs: { name: string }[] };
    assert.equal(body.clubs.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Phase 2.0 Plan 02-02 task 2 — hired_card extension to POST /api/competitors.
//
// - hired_card omitted / false behaves IDENTICALLY to Phase 1 (regression
//   coverage is the existing tests 1-9 above).
// - hired_card=true + valid hired_contact (at least phone OR email) →
//   competitor + hired_cards row both inserted in one transaction.
// - hired_card=true + missing both phone AND email → 400
//   hyrbricka_contact_required with NO competitor row inserted
//   (pre-flight runs BEFORE the transaction per PATTERNS S-5).
// - hired_card=true + card_taken (409) does NOT insert a hired_cards row.
// - Re-rental of the same card (after delete) uses .onConflictDoUpdate
//   on the compound PK [competitionId, cardNumber] (Pitfall 10).
// ---------------------------------------------------------------------------

import { hiredCards } from '../db/schema.ts';

describe('Phase 2.0 — hired_card extension (Plan 02-02)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test HB1: POST without hired_card (or hired_card=false) does NOT insert a hired_cards row', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'No-rental',
        club: null,
        class_id: classId,
        card_number: 88888,
        consent: true,
        hired_card: false,
      },
    });
    assert.equal(res.statusCode, 201);
    const rows = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(rows.length, 0, 'no hired_cards row when hired_card=false');
  });

  test('test HB2: hired_card=true + phone-only contact → 201 AND a hired_cards row exists', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Foo',
        club: null,
        class_id: classId,
        card_number: 88888,
        consent: true,
        hired_card: true,
        hired_contact: {
          name: 'Foo',
          phone: '0701234567',
          email: null,
          note: null,
        },
      },
    });
    assert.equal(res.statusCode, 201, `body: ${res.body}`);
    const rows = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.competitionId, competitionId);
    assert.equal(row.cardNumber, 88888);
    assert.equal(row.contactPhone, '0701234567');
    assert.equal(row.contactEmail, null);
    assert.equal(row.returnedAtMs, null);
    assert.ok(row.markedAtMs > 0);
  });

  test('test HB3: hired_card=true + both phone AND email empty → 400 hyrbricka_contact_required, NO competitor row', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Empty Contact',
        club: null,
        class_id: classId,
        card_number: 88889,
        consent: true,
        hired_card: true,
        hired_contact: { name: null, phone: null, email: null, note: null },
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'hyrbricka_contact_required');
    // No competitor row written (pre-flight before transaction).
    const compRows = ctx.handle.db.select().from(competitors).all();
    assert.equal(compRows.length, 0);
    // No hired_cards row.
    const hrRows = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(hrRows.length, 0);
  });

  test('test HB3b: hired_card=true + hired_contact omitted entirely → 400 hyrbricka_contact_required', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Empty Contact',
        club: null,
        class_id: classId,
        card_number: 88891,
        consent: true,
        hired_card: true,
        // hired_contact omitted
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'hyrbricka_contact_required');
  });

  test('test HB4: hired_card=true with email-only also satisfies the gate', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Email Only',
        club: null,
        class_id: classId,
        card_number: 88890,
        consent: true,
        hired_card: true,
        hired_contact: {
          name: null,
          phone: null,
          email: 'foo@example.com',
          note: 'spare card',
        },
      },
    });
    assert.equal(res.statusCode, 201);
    const row = ctx.handle.db.select().from(hiredCards).get();
    assert.ok(row);
    assert.equal(row.contactEmail, 'foo@example.com');
    assert.equal(row.note, 'spare card');
  });

  test('test HB5: 409 card-collision on hired POST does NOT leave a hired_cards row', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    // First competitor claims card 88888 with NO hired flag.
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Owner',
        class_id: classId,
        card_number: 88888,
        consent: true,
      },
    });
    assert.equal(first.statusCode, 201);

    // Second POST tries to claim the same card AS a hired rental → 409 from
    // the pre-flight card_taken check; hired_cards must be empty.
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Renter',
        class_id: classId,
        card_number: 88888,
        consent: true,
        hired_card: true,
        hired_contact: { name: 'Renter', phone: '0709999999', email: null, note: null },
      },
    });
    assert.equal(second.statusCode, 409);
    const rows = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(rows.length, 0, '409 must not leave a stray hired_cards row');
  });
});

// Item G (02.1-14 follow-up): the web's patchCompetitorStartTime target.
describe('PATCH /api/competitions/:id/competitors/:competitorId/start-time', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  async function seedRunner(): Promise<{ competitionId: string; competitorId: string }> {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { competition_id: competitionId, name: 'Anna', class_id: classId, consent: true },
    });
    return { competitionId, competitorId: (res.json() as { id: string }).id };
  }

  const patch = (competitionId: string, competitorId: string, payload: unknown) =>
    ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/start-time`,
      payload: payload as Record<string, unknown>,
    });

  const START = Date.parse('2026-05-22T08:00:00Z');

  test('sets start_time_ms and returns the competitor DTO; null clears it', async () => {
    const { competitionId, competitorId } = await seedRunner();
    const res = await patch(competitionId, competitorId, { start_time_ms: START });
    assert.equal(res.statusCode, 200);
    const dto = res.json() as { id: string; start_time_ms: number | null };
    assert.equal(dto.id, competitorId);
    assert.equal(dto.start_time_ms, START);
    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .get();
    assert.equal(row?.startTimeMs, START);

    const cleared = await patch(competitionId, competitorId, { start_time_ms: null });
    assert.equal(cleared.statusCode, 200);
    assert.equal((cleared.json() as { start_time_ms: number | null }).start_time_ms, null);
    const after = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .get();
    assert.equal(after?.startTimeMs, null);
  });

  test('SOFT TR 4.18.9: a late start keeps the original start time; a new start set via PATCH (organiser error) is what the time runs from', async () => {
    const at = (sec: number): number => localToEpochMs('2026-05-22', sec);
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Sen Starter',
        class_id: classId,
        card_number: 4242,
        consent: true,
      },
    });
    const competitorId = (created.json() as { id: string }).id;
    // Drawn 10:00:00; punched start 10:22:06; finish 10:52:00.
    assert.equal(
      (await patch(competitionId, competitorId, { start_time_ms: at(36_000) })).statusCode,
      200
    );
    ctx.handle.sqlite
      .prepare('UPDATE competitions SET race_started_at_ms = 1 WHERE id = ?')
      .run(competitionId);
    const clock = (sec: number) => ({
      half_day: 0 as const,
      seconds_in_half_day: sec,
      weekday: null,
    });
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'test-node',
        localSeq: 1,
        competitionId,
        eventType: 'card_read',
        eventTimeMs: at(39_600),
        recordedAtMs: at(39_600),
        payload: {
          event_type: 'card_read',
          card_number: 4242,
          card_type: 'SI10',
          start: clock(36_000 + 22 * 60 + 6),
          finish: clock(36_000 + 52 * 60),
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
    const row = async () => {
      // The PATCH marks the projection dirty (debounced); recompute now.
      ctx.app.projectionStore.recomputeNow(competitionId);
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${competitionId}/results`,
      });
      return (res.json() as { classes: Array<{ rows: Array<{ elapsed_time_ms: number | null }> }> })
        .classes[0]!.rows[0]!;
    };
    // Own fault: the original start time applies (52:00), with a late-start warning.
    assert.equal((await row()).elapsed_time_ms, 52 * 60 * 1000);
    assert.ok(
      (ctx.app.projectionStore.recomputeNow(competitionId)!.competitors.get(competitorId)!
        .late_start_ms ?? 0) > 60_000
    );
    // Organiser error: the secretariat sets the new start 10:22:00 → 30:00.
    const moved = await patch(competitionId, competitorId, { start_time_ms: at(36_000 + 22 * 60) });
    assert.equal(moved.statusCode, 200);
    assert.equal((await row()).elapsed_time_ms, 30 * 60 * 1000);
  });

  test('bad value → 400', async () => {
    const { competitionId, competitorId } = await seedRunner();
    // Local ms-since-midnight (the old base), fractions, strings, missing.
    for (const body of [
      { start_time_ms: 36_000_000 },
      { start_time_ms: START + 0.5 },
      { start_time_ms: String(START) },
      {},
    ]) {
      const res = await patch(competitionId, competitorId, body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
  });

  test('operator-guarded: a LAN client without an event-code cookie → 403', async () => {
    const { competitionId, competitorId } = await seedRunner();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/start-time`,
      payload: { start_time_ms: START },
      remoteAddress: '10.0.0.5',
    });
    assert.equal(res.statusCode, 403);
  });

  test('unknown competitor (or one from another competition) → 404', async () => {
    const { competitionId, competitorId } = await seedRunner();
    const other = await seedCompetitionAndClass(ctx.app);
    const unknown = await patch(competitionId, crypto.randomUUID(), { start_time_ms: START });
    assert.equal(unknown.statusCode, 404);
    const cross = await patch(other.competitionId, competitorId, { start_time_ms: START });
    assert.equal(cross.statusCode, 404);
  });
});

describe('PATCH /api/competitors/:id/profile — bib (SOFT TR 7.5.4)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('sets a bib by hand, refuses one another runner has (409), and empty clears it', async () => {
    const { competitionId, classId } = await seedCompetitionAndClass(ctx.app);
    const add = async (name: string) =>
      (
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/competitors',
            payload: { competition_id: competitionId, name, class_id: classId, consent: true },
          })
        ).json() as { id: string }
      ).id;
    const anna = await add('Anna');
    const bo = await add('Bo');
    const patch = (id: string, bib: string | null) =>
      ctx.app.inject({ method: 'PATCH', url: `/api/competitors/${id}/profile`, payload: { bib } });

    let res = await patch(anna, ' 101 ');
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { competitor: { bib: string } }).competitor.bib, '101');
    res = await patch(bo, '101');
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'bib_taken', bib: '101' });
    assert.equal((await patch(anna, '101')).statusCode, 200, 'keeping its own bib is fine');
    res = await patch(anna, '');
    assert.equal((res.json() as { competitor: { bib: string | null } }).competitor.bib, null);
    assert.equal((await patch(bo, '101')).statusCode, 200);
  });
});

describe('fees charged at registration (SOFT TR 4.12.4, TR 4.12.6)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  /** A competition on `date` with H21 (senior) and Gul (open), fees set. */
  async function seed(date: string) {
    const comp = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Avgifter', date },
    });
    const competitionId = (comp.json() as { id: string }).id;
    const mk = async (name: string) =>
      (
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/competitions/${competitionId}/classes`,
            payload: { name },
          })
        ).json() as { id: string }
      ).id;
    const h21 = await mk('H21');
    const gul = await mk('Gul 2,5');
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/competitions/${competitionId}/fees`,
      payload: {
        card_fee: 30,
        classes: [
          { class_id: h21, entry_fee: 180, youth_entry_fee: null, late_fee_pct: 100 },
          { class_id: gul, entry_fee: 180, youth_entry_fee: 90, late_fee_pct: 50 },
        ],
      },
    });
    assert.equal(put.statusCode, 200, put.body);
    return { competitionId, h21, gul };
  }

  const register = async (
    competitionId: string,
    classId: string,
    card: number,
    extra: Record<string, unknown> = {}
  ) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Eva Ek',
        class_id: classId,
        card_number: card,
        consent: true,
        ...extra,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = (res.json() as { id: string }).id;
    return ctx.handle.db.select().from(competitors).where(eq(competitors.id, id)).get()!;
  };

  test('walk-up on the day in an adult age class: fee + surcharge up to 100 %', async () => {
    const { competitionId, h21 } = await seed('2026-05-22');
    const row = await register(competitionId, h21, 1001);
    assert.deepEqual([row.entryFee, row.lateFee], [180, 180]);
  });

  test('a late entry before the competition day: the surcharge is capped at 50 %', async () => {
    const { competitionId, h21 } = await seed('2099-01-01');
    const row = await register(competitionId, h21, 1002);
    assert.deepEqual([row.entryFee, row.lateFee], [180, 90]);
  });

  test('open class: youth pay the youth fee and no surcharge', async () => {
    const { competitionId, gul } = await seed('2026-05-22');
    const youth = await register(competitionId, gul, 1003, { youth: true });
    assert.deepEqual([youth.entryFee, youth.lateFee], [90, 0]);
    const adult = await register(competitionId, gul, 1004);
    assert.deepEqual([adult.entryFee, adult.lateFee], [180, 90]);
  });

  test('a class without a fee records none', async () => {
    const { competitionId } = await seed('2026-05-22');
    const other = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/competitions/${competitionId}/classes`,
          payload: { name: 'D21' },
        })
      ).json() as { id: string }
    ).id;
    const row = await register(competitionId, other, 1005);
    assert.deepEqual([row.entryFee, row.lateFee], [null, null]);
  });

  test('the card fee is charged only with a hired card', async () => {
    const { competitionId, h21 } = await seed('2026-05-22');
    await register(competitionId, h21, 1006);
    await register(competitionId, h21, 1007, {
      hired_card: true,
      hired_contact: { name: null, phone: '0701234567', email: null, note: null },
    });
    const rows = ctx.handle.db.select().from(hiredCards).all();
    assert.deepEqual(
      rows.map((r) => [r.cardNumber, r.fee]),
      [[1007, 30]]
    );
  });
});
