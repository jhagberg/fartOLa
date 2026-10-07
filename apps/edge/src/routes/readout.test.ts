// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET /api/competitions/:id/readout (plan 09 task 2).
//
// Tests:
//   1. Seeded competition with 0 events → 200; history=[]; current_read=null;
//      pending_unknown_cards=[].
//   2. Seeded competition with 1 matched card_read (course OK) → 200;
//      history[0].status='OK', current_read.competitor_id matches.
//   3. 15 card_read events → history.length === 12 (cap).
//   4. card_read for an unknown card → history[0].unmatched=true;
//      pending_unknown_cards includes that card.
//   5. GET on a competition where ANOTHER competition is active → active=false.
//      GET on the active competition → active=true.
//   6. GET on non-existent competition → 200 with empty arrays (Phase 1
//      deliberate; plan 11 wizard ensures competitions exist before
//      navigating to readout).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-09-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Readout view live behavior"

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import {
  classes,
  controls,
  courses,
  courseControls,
  competitors,
  events,
  hiredCards,
} from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { HalfDayClock } from '@fartola/sportident';
import { eq } from 'drizzle-orm';
import { localToEpochMs } from '../time/competitionClock.ts';

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

function insertCardRead(
  handle: DbHandle,
  nodeId: string,
  competitionId: string,
  cardNumber: number,
  eventTimeMs: number,
  localSeq: number,
  punches: number[] = [31],
  start: HalfDayClock | null = {
    half_day: 0,
    seconds_in_half_day: 9 * 3600,
    weekday: null,
  },
  check: HalfDayClock | null = null
): void {
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq,
      competitionId,
      eventType: 'card_read',
      eventTimeMs,
      recordedAtMs: eventTimeMs,
      payload: {
        event_type: 'card_read',
        card_number: cardNumber,
        card_type: 'SI10',
        start,
        finish: { half_day: 0, seconds_in_half_day: 9 * 3600 + 30 * 60, weekday: null },
        check,
        clear: null,
        punch_count: punches.length,
        punches: punches.map((code) => ({
          code,
          seconds_in_half_day: 9 * 3600 + 15 * 60,
          half_day: 0,
          weekday: null,
        })),
        card_holder: null,
      },
    })
    .run();
}

interface ReadoutBody {
  competition_id: string;
  active: boolean;
  current_read: {
    event_time_ms: number;
    local_seq: number;
    card_number: number;
    card_type: string;
    competitor_id: string | null;
    competitor_name: string | null;
    status: string;
    unmatched: boolean;
  } | null;
  history: Array<{
    event_time_ms: number;
    card_number: number;
    competitor_id: string | null;
    status: string;
    unmatched: boolean;
  }>;
  pending_unknown_cards: number[];
  voided_codes: number[];
}

describe('GET /api/competitions/:id/readout', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: seeded competition with 0 events → 200; history empty; current_read null', async () => {
    seedCompetition(ctx.handle, 'comp-1');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-1/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ReadoutBody;
    assert.equal(body.competition_id, 'comp-1');
    assert.deepEqual(body.history, []);
    assert.equal(body.current_read, null);
    assert.deepEqual(body.pending_unknown_cards, []);
  });

  test('test 2: matched card_read produces status=OK and current_read.competitor_id', async () => {
    const { competitorId } = seedCompetition(ctx.handle, 'comp-2');
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-2', 7501853, 100, 1);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-2/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ReadoutBody;
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0]?.status, 'OK');
    assert.equal(body.history[0]?.competitor_id, competitorId);
    assert.equal(body.history[0]?.unmatched, false);
    assert.ok(body.current_read);
    assert.equal(body.current_read.competitor_id, competitorId);
    assert.equal(body.current_read.status, 'OK');
  });

  test('test 1b: voided_codes follows control_voided / control_unvoided', async () => {
    seedCompetition(ctx.handle, 'comp-v');
    const get = async (): Promise<number[]> =>
      (
        (
          await ctx.app.inject({ method: 'GET', url: '/api/competitions/comp-v/readout' })
        ).json() as ReadoutBody
      ).voided_codes;
    assert.deepEqual(await get(), []);
    await ctx.app.inject({ method: 'POST', url: '/api/competitions/comp-v/voided-controls/32' });
    assert.deepEqual(await get(), [32]);
    await ctx.app.inject({ method: 'DELETE', url: '/api/competitions/comp-v/voided-controls/32' });
    assert.deepEqual(await get(), []);
  });

  // 02.1-14 Task 13: the row carries the missing-start flag and suggestion.
  test('test 2b: no start of either kind → missing_start + check + 1:54', async () => {
    seedCompetition(ctx.handle, 'comp-2b');
    const check: HalfDayClock = {
      half_day: 0,
      seconds_in_half_day: 8 * 3600 + 58 * 60,
      weekday: null,
    };
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-2b', 7501853, 100, 1, [31], null, check);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/competitions/comp-2b/readout' });
    const row = (
      res.json() as {
        history: Array<{
          missing_start: boolean;
          suggested_start_ms: number | null;
          suggested_start_offset_ms: number | null;
          suggested_start_wall: string | null;
          finish_wall: string | null;
        }>;
      }
    ).history[0]!;
    assert.equal(row.missing_start, true);
    assert.equal(row.suggested_start_offset_ms, 114_000);
    assert.equal(typeof row.suggested_start_ms, 'number');
    // The card's clock as wall-clock strings (read at epoch 100 ms, 01:00
    // local on 1970-01-01, so the 08:58 check and 09:30 finish are the day
    // before): what the UI resolves an edited start against.
    assert.equal(row.suggested_start_wall, '1969-12-31T08:59:54');
    assert.equal(row.finish_wall, '1969-12-31T09:30:00');
  });

  // 02.1-14 Task 14: late start warning on the row (SOFT TR 4.18.9 (2026-07-01)).
  test('test 2c: start punch 3:12 after the start time → late_start_ms on the row', async () => {
    const { competitorId } = seedCompetition(ctx.handle, 'comp-2c');
    const readAt = localToEpochMs('2026-05-14', 9 * 3600 + 40 * 60);
    const startTime = localToEpochMs('2026-05-14', 9 * 3600) - 192_000; // 08:56:48
    ctx.handle.db
      .update(competitors)
      .set({ startTimeMs: startTime })
      .where(eq(competitors.id, competitorId))
      .run();
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-2c', 7501853, readAt, 1); // punch 09:00:00
    const res = await ctx.app.inject({ method: 'GET', url: '/api/competitions/comp-2c/readout' });
    const row = (
      res.json() as {
        history: Array<{ late_start_ms: number | null; early_start_ms: number | null }>;
      }
    ).history[0]!;
    assert.equal(row.late_start_ms, 192_000);
    assert.equal(row.early_start_ms, null);
  });

  test('test 3: 15 card_read events → history.length === 12 (cap)', async () => {
    seedCompetition(ctx.handle, 'comp-3');
    for (let i = 1; i <= 15; i++) {
      insertCardRead(ctx.handle, ctx.nodeId, 'comp-3', 7501853, i * 100, i);
    }
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-3/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ReadoutBody;
    assert.equal(body.history.length, 12);
    // Newest first: the first row is the highest event_time_ms (i=15 → 1500).
    assert.equal(body.history[0]?.event_time_ms, 1500);
    // The last row in the (capped) history is event_time_ms = 400 (i=4),
    // because i=1..3 fell off (15 events - 12 cap = 3 dropped from oldest).
    assert.equal(body.history[11]?.event_time_ms, 400);
  });

  test('test 4: unknown card → history[0].unmatched=true; pending_unknown_cards contains the card', async () => {
    seedCompetition(ctx.handle, 'comp-4');
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-4', 9_999_999, 100, 1);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-4/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ReadoutBody;
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0]?.unmatched, true);
    assert.equal(body.history[0]?.competitor_id, null);
    assert.equal(body.history[0]?.status, 'PEND');
    assert.deepEqual(body.pending_unknown_cards, [9_999_999]);
  });

  test('test 5: active flag mirrors app.activeCompetitionId', async () => {
    seedCompetition(ctx.handle, 'comp-5a');
    seedCompetition(ctx.handle, 'comp-5b');

    // No active competition: both report active=false.
    const r1 = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-5a/readout',
    });
    assert.equal(r1.statusCode, 200);
    assert.equal((r1.json() as ReadoutBody).active, false);

    // Set comp-5a active via the sessions REST surface.
    const setActive = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions/active-competition',
      payload: { competition_id: 'comp-5a' },
    });
    assert.equal(setActive.statusCode, 200);

    const r2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-5a/readout',
    });
    const r3 = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-5b/readout',
    });
    assert.equal((r2.json() as ReadoutBody).active, true);
    assert.equal((r3.json() as ReadoutBody).active, false);
  });

  test('test 6: GET on non-existent competition → 200 with empty arrays (Phase 1 deliberate)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/does-not-exist/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ReadoutBody;
    assert.equal(body.competition_id, 'does-not-exist');
    assert.equal(body.active, false);
    assert.deepEqual(body.history, []);
    assert.equal(body.current_read, null);
    assert.deepEqual(body.pending_unknown_cards, []);
  });

  // ===========================================================================
  // Phase 2.0 Plan 02-05 — hired_card_open field on every history row.
  // Single source of truth for the Hyrbricka finish-readout toast.
  // ===========================================================================

  test('test 7 (Plan 02-05): card with open hired_cards row gains hired_card_open payload', async () => {
    seedCompetition(ctx.handle, 'comp-7');
    // Open rental for card 7501853 (the same card the test competitor holds).
    ctx.handle.db
      .insert(hiredCards)
      .values({
        competitionId: 'comp-7',
        cardNumber: 7501853,
        markedAtMs: 50,
        returnedAtMs: null,
        contactName: 'Renter Person',
        contactPhone: '0701234567',
        contactEmail: 'renter@example.com',
        note: 'borrowed @ check-in',
      })
      .run();
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-7', 7501853, 100, 1);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-7/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      history: Array<{
        card_number: number;
        hired_card_open: {
          contact_name: string | null;
          contact_phone: string | null;
          contact_email: string | null;
          note: string | null;
        } | null;
      }>;
    };
    assert.equal(body.history.length, 1);
    const row = body.history[0];
    assert.ok(row);
    assert.equal(row.card_number, 7501853);
    assert.ok(row.hired_card_open);
    assert.equal(row.hired_card_open.contact_name, 'Renter Person');
    assert.equal(row.hired_card_open.contact_phone, '0701234567');
    assert.equal(row.hired_card_open.contact_email, 'renter@example.com');
    assert.equal(row.hired_card_open.note, 'borrowed @ check-in');
  });

  test('test 7b (Plan 02-05): card with NO open rental has hired_card_open === null (explicit)', async () => {
    seedCompetition(ctx.handle, 'comp-7b');
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-7b', 7501853, 100, 1);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-7b/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      history: Array<{
        card_number: number;
        hired_card_open: unknown;
      }>;
    };
    assert.equal(body.history.length, 1);
    const row = body.history[0];
    assert.ok(row);
    // Explicit null (not absent) so the web client can branch on
    // `hired_card_open !== null` without `in` checks.
    assert.equal('hired_card_open' in row, true);
    assert.equal(row.hired_card_open, null);
  });

  test('test 7c (Plan 02-05): RETURNED rental does NOT populate hired_card_open', async () => {
    seedCompetition(ctx.handle, 'comp-7c');
    // Card has a hired_cards row but it's been returned — toast should not fire.
    ctx.handle.db
      .insert(hiredCards)
      .values({
        competitionId: 'comp-7c',
        cardNumber: 7501853,
        markedAtMs: 50,
        returnedAtMs: 75, // returned BEFORE the read
        contactName: 'Renter Person',
        contactPhone: '0701234567',
        contactEmail: null,
        note: null,
      })
      .run();
    insertCardRead(ctx.handle, ctx.nodeId, 'comp-7c', 7501853, 100, 1);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-7c/readout',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      history: Array<{ hired_card_open: unknown }>;
    };
    assert.equal(body.history[0]?.hired_card_open, null);
  });
});
