// Authored for fartola. Not ported from upstream.
//
// node:test coverage for routes/cardBinds.ts: an entered runner who reads
// out with a new card is rebound (POST /api/competitors replace mode), the
// read attaches without a new read-out, and the change can be undone.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import {
  classes,
  competitors,
  controls,
  courseControls,
  courses,
  events,
  type EventPayload,
} from '../db/schema.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
}

const COMP = '00000000-0000-4000-8000-0000000000c1';
const EVA = '00000000-0000-4000-8000-0000000000e1';
const BO = '00000000-0000-4000-8000-0000000000b1';
const WALK = '00000000-0000-4000-8000-0000000000a1';
const OLD = 1_111_111;
const NEW = 2_222_222;
let seq = 1000;

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

/** A competition (race started) with one class per course; codes per course. */
function seed(handle: DbHandle, coursesByClass: Record<string, number[]>): void {
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
       VALUES (?, 'C', '2026-05-14', 'classic', 0, 1000, 0)`
    )
    .run(COMP);
  const controlIds = new Map<number, string>();
  for (const [className, codes] of Object.entries(coursesByClass)) {
    const classId = `cls-${className}`;
    handle.db.insert(classes).values({ id: classId, competitionId: COMP, name: className }).run();
    const courseId = `crs-${className}`;
    handle.db
      .insert(courses)
      .values({ id: courseId, competitionId: COMP, name: className, classId })
      .run();
    codes.forEach((code, i) => {
      let controlId = controlIds.get(code);
      if (controlId === undefined) {
        controlId = `ctl-${code}`;
        controlIds.set(code, controlId);
        handle.db.insert(controls).values({ id: controlId, competitionId: COMP, code }).run();
      }
      handle.db
        .insert(courseControls)
        .values({ id: `cc-${className}-${i}`, courseId, controlId, orderIdx: i })
        .run();
    });
  }
}

function addRunner(
  handle: DbHandle,
  id: string,
  className: string,
  cardNumber: number | null,
  startTimeMs: number | null = null
): void {
  handle.db
    .insert(competitors)
    .values({
      id,
      competitionId: COMP,
      name: `Runner ${id}`,
      club: 'OK Test',
      classId: `cls-${className}`,
      cardNumber,
      consentAtMs: 1000,
      consentStatus: 'explicit',
      scrubbedAtMs: null,
      startTimeMs,
    })
    .run();
}

/** Read at 11:00 local on the competition day (CEST). */
const READ_AT_MS = 1_778_749_200_000;
/** The card's 10:00:00 start punch on the competition clock. */
const CARD_START_MS = READ_AT_MS - 3600_000;

/** A finished read: start 10:00:00, finish 10:30:00 (card clock), given codes;
 * `withStart` false = check punch at 09:58:00 and no start punch. */
function addRead(
  handle: DbHandle,
  nodeId: string,
  cardNumber: number,
  codes: number[],
  withStart = true
): void {
  seq += 1;
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq: seq,
      competitionId: COMP,
      eventType: 'card_read',
      eventTimeMs: READ_AT_MS + seq,
      recordedAtMs: READ_AT_MS + seq,
      payload: {
        event_type: 'card_read',
        card_number: cardNumber,
        card_type: 'SI10',
        start: withStart ? { half_day: 0, seconds_in_half_day: 10 * 3600, weekday: null } : null,
        finish: { half_day: 0, seconds_in_half_day: 10 * 3600 + 1800, weekday: null },
        check: withStart
          ? null
          : { half_day: 0, seconds_in_half_day: 9 * 3600 + 58 * 60, weekday: null },
        clear: null,
        punch_count: codes.length,
        punches: codes.map((code, i) => ({
          code,
          seconds_in_half_day: 10 * 3600 + 60 * (i + 1),
          half_day: 0,
          weekday: null,
        })),
        card_holder: null,
      },
    })
    .run();
}

async function rebind(
  app: FastifyInstance,
  competitorId: string,
  cardNumber: number
): Promise<{ node_id: string; local_seq: number; previous_card_number: number | null }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/competitors',
    payload: {
      competition_id: COMP,
      card_number: cardNumber,
      replace_card_for_competitor_id: competitorId,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  return (
    res.json() as {
      card_event: { node_id: string; local_seq: number; previous_card_number: number | null };
    }
  ).card_event;
}

async function readout(app: FastifyInstance) {
  app.projectionStore.recomputeNow(COMP);
  const res = await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/readout` });
  return res.json() as {
    history: Array<{
      card_number: number;
      competitor_id: string | null;
      status: string;
      unmatched: boolean;
    }>;
    pending_unknown_cards: number[];
  };
}

const undo = (app: FastifyInstance, ev: { node_id: string; local_seq: number }) =>
  app.inject({
    method: 'POST',
    url: `/api/competitions/${COMP}/card-binds/undo`,
    payload: { node_id: ev.node_id, local_seq: ev.local_seq },
  });

describe('POST /api/competitions/:id/card-binds/undo', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    seed(ctx.handle, { H21: [31, 32, 33] });
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('rebind → one competitor, result attached, old card logged; undo restores the old card', async () => {
    addRunner(ctx.handle, EVA, 'H21', OLD);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33]);
    assert.deepEqual((await readout(ctx.app)).pending_unknown_cards, [NEW]);

    const ev = await rebind(ctx.app, EVA, NEW);
    assert.equal(ev.previous_card_number, OLD);

    const after = await readout(ctx.app);
    assert.deepEqual(after.pending_unknown_cards, []);
    assert.equal(after.history[0]!.competitor_id, EVA);
    assert.equal(after.history[0]!.status, 'OK');
    const all = ctx.handle.db.select().from(competitors).all();
    assert.equal(all.length, 1, 'no duplicate competitor');

    const res = await undo(ctx.app, ev);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal((res.json() as { card_number: number | null }).card_number, OLD);
    const row = ctx.handle.db.select().from(competitors).where(eq(competitors.id, EVA)).get();
    assert.equal(row?.cardNumber, OLD);
    const undone = await readout(ctx.app);
    assert.deepEqual(undone.pending_unknown_cards, [NEW]);
    assert.equal(undone.history[0]!.unmatched, true);

    const undoEvent = ctx.handle.db
      .select()
      .from(events)
      .all()
      .map((e) => e.payload as EventPayload)
      .find((p) => p.event_type === 'card_bound' && p.undoes !== undefined);
    assert.deepEqual(undoEvent, {
      event_type: 'card_bound',
      competitor_id: EVA,
      card_number: OLD,
      walkup: false,
      consent_at_ms: 1000,
      previous_card_number: NEW,
      undoes: { node_id: ev.node_id, local_seq: ev.local_seq },
    });

    const again = await undo(ctx.app, ev);
    assert.equal(again.statusCode, 409);
    assert.equal((again.json() as { error: string }).error, 'already_undone');
  });

  test('a runner entered without a card: undo clears the card again', async () => {
    addRunner(ctx.handle, EVA, 'H21', null);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33]);
    const ev = await rebind(ctx.app, EVA, NEW);
    assert.equal(ev.previous_card_number, null);

    const res = await undo(ctx.app, ev);
    assert.equal(res.statusCode, 201, res.body);
    const row = ctx.handle.db.select().from(competitors).where(eq(competitors.id, EVA)).get();
    assert.equal(row?.cardNumber, null);
    assert.deepEqual((await readout(ctx.app)).pending_unknown_cards, [NEW]);
    const kinds = ctx.handle.db
      .select()
      .from(events)
      .all()
      .map((e) => e.eventType);
    assert.ok(kinds.includes('card_unbound'));
  });

  test('card changed again since → 409 card_changed_since', async () => {
    addRunner(ctx.handle, EVA, 'H21', OLD);
    const ev = await rebind(ctx.app, EVA, NEW);
    await rebind(ctx.app, EVA, 3_333_333);
    const res = await undo(ctx.app, ev);
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as { error: string }).error, 'card_changed_since');
  });

  test('old card now held by someone else → 409 card_taken', async () => {
    addRunner(ctx.handle, EVA, 'H21', OLD);
    const ev = await rebind(ctx.app, EVA, NEW);
    addRunner(ctx.handle, BO, 'H21', OLD);
    const res = await undo(ctx.app, ev);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'card_taken', existing_competitor_id: BO });
  });

  test('unknown event → 404; a direct-entry bind (no old card logged) → 409 not_undoable', async () => {
    const missing = await undo(ctx.app, { node_id: ctx.nodeId, local_seq: 99_999 });
    assert.equal(missing.statusCode, 404);

    addRunner(ctx.handle, WALK, 'H21', 4_444_444);
    // A card_bound without previous_card_number, as direct entry writes.
    seq += 1;
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: ctx.nodeId,
        localSeq: seq,
        competitionId: COMP,
        eventType: 'card_bound',
        eventTimeMs: 1,
        recordedAtMs: 1,
        payload: {
          event_type: 'card_bound',
          competitor_id: WALK,
          card_number: 4_444_444,
          walkup: true,
          consent_at_ms: 1,
        },
      })
      .run();
    const res = await undo(ctx.app, { node_id: ctx.nodeId, local_seq: seq });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as { error: string }).error, 'not_undoable');
  });
});

interface EnteredRunner {
  competitor_id: string;
  name: string;
  class_name: string;
  card_number: number | null;
  missing: number | null;
  start_diff_ms: number | null;
  suggested: boolean;
}

const entries = async (app: FastifyInstance, card: number) => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/competitions/${COMP}/cards/${card}/entries`,
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { clock_offset_min: number; runners: EnteredRunner[] };
  assert.equal(body.clock_offset_min, 120);
  return body.runners;
};

describe('GET /api/competitions/:id/cards/:cardNumber/entries', () => {
  let ctx: Ctx;
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const C = '00000000-0000-4000-8000-00000000000c';
  beforeEach(async () => {
    ctx = await boot();
    seed(ctx.handle, { H21: [31, 32, 33, 34], D21: [41, 42, 43, 44] });
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test("punches match one entered, unread runner's course → that runner is the first suggestion", async () => {
    addRunner(ctx.handle, A, 'D21', 500);
    addRunner(ctx.handle, B, 'H21', 600);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33, 34]);
    const runners = await entries(ctx.app, NEW);
    assert.equal(runners[0]!.competitor_id, B);
    assert.equal(runners[0]!.suggested, true);
    assert.equal(runners[0]!.missing, 0);
    assert.equal(runners[0]!.class_name, 'H21');
    assert.equal(runners[0]!.card_number, 600);
    const other = runners.find((r) => r.competitor_id === A)!;
    assert.equal(other.suggested, false);
  });

  test('runners who have read out are left out', async () => {
    addRunner(ctx.handle, A, 'H21', 500);
    addRunner(ctx.handle, B, 'H21', 600);
    addRead(ctx.handle, ctx.nodeId, 500, [31, 32, 33, 34]);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33, 34]);
    const runners = await entries(ctx.app, NEW);
    assert.deepEqual(
      runners.map((r) => r.competitor_id),
      [B]
    );
  });

  test('same course: the start time closest to the card start comes first', async () => {
    addRunner(ctx.handle, A, 'H21', 500, CARD_START_MS + 20 * 60_000);
    addRunner(ctx.handle, B, 'H21', 600, CARD_START_MS - 2 * 60_000);
    addRunner(ctx.handle, C, 'H21', 700, null);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33, 34]);
    const runners = await entries(ctx.app, NEW);
    assert.deepEqual(
      runners.map((r) => r.competitor_id),
      [B, A, C]
    );
    assert.equal(runners[0]!.start_diff_ms, 2 * 60_000);
  });

  test('no start punch: the check punch plus the usual check → start gap is used', async () => {
    addRunner(ctx.handle, A, 'H21', 500, CARD_START_MS + 10 * 60_000);
    addRunner(ctx.handle, B, 'H21', 600, CARD_START_MS);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33, 34], false);
    const runners = await entries(ctx.app, NEW);
    assert.equal(runners[0]!.competitor_id, B);
    // Check 09:58:00 + the default 1:54 gap = 09:59:54.
    assert.equal(runners[0]!.start_diff_ms, 6_000);
  });

  test('a mispunch (one control missing) still fits; a card without a read lists everyone, none suggested', async () => {
    addRunner(ctx.handle, A, 'H21', 500);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 33, 34]);
    const mp = await entries(ctx.app, NEW);
    assert.equal(mp[0]!.suggested, true);
    assert.equal(mp[0]!.missing, 1);

    const none = await entries(ctx.app, 9_999_999);
    assert.deepEqual(
      none.map((r) => [r.competitor_id, r.suggested]),
      [[A, false]]
    );
  });

  test('unknown competition → 404', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/nope/cards/1/entries',
    });
    assert.equal(res.statusCode, 404);
  });
});
