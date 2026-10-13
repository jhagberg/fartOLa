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
  withStart = true,
  atMs?: number
): void {
  seq += 1;
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq: seq,
      competitionId: COMP,
      eventType: 'card_read',
      eventTimeMs: atMs ?? READ_AT_MS + seq,
      recordedAtMs: atMs ?? READ_AT_MS + seq,
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

// A runner who has a result keeps it (routes/_cardResult.ts): "Ändra",
// "Byt bricka" and the undo of a card change, one runner at a time.
describe('a card change that takes a result away is refused until it is confirmed', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    seed(ctx.handle, { H21: [31, 32, 33] });
    addRunner(ctx.handle, EVA, 'H21', OLD);
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  /** A read stored now, after everything stored so far. */
  const readNow = (card: number, atMs?: number): void => {
    const top = ctx.handle.db
      .select()
      .from(events)
      .all()
      .reduce((m, e) => Math.max(m, e.localSeq), seq);
    seq = top;
    addRead(ctx.handle, ctx.nodeId, card, [31, 32, 33], true, atMs);
  };
  const statusOf = (id: string): string =>
    ctx.app.projectionStore.recomputeNow(COMP)!.competitors.get(id)!.status;
  const cardOf = (id: string): number | null =>
    ctx.handle.db.select().from(competitors).where(eq(competitors.id, id)).get()!.cardNumber;
  /** The newest stored event: the read just made. */
  const topSeq = (): number =>
    ctx.handle.db
      .select()
      .from(events)
      .all()
      .reduce((m, e) => Math.max(m, e.localSeq), 0);
  const HAS_RESULT = (
    card: number,
    status: string,
    reads: number,
    lastReadSeq: number,
    cardSeq = 0
  ) => ({
    error: 'has_result',
    competitor_id: EVA,
    name: `Runner ${EVA}`,
    lose_result: {
      card_number: card,
      card_seq: cardSeq,
      status,
      reads,
      last_read_seq: lastReadSeq,
    },
  });

  const edit = (payload: object) =>
    ctx.app.inject({ method: 'PATCH', url: `/api/competitors/${EVA}/profile`, payload });
  const replace = (payload: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { competition_id: COMP, replace_card_for_competitor_id: EVA, ...payload },
    });

  for (const [name, change] of [
    ['"Ändra", another card', (extra: object) => edit({ card_number: NEW, ...extra })],
    ['"Ändra", no card', (extra: object) => edit({ card_number: null, ...extra })],
    ['"Byt bricka"', (extra: object) => replace({ card_number: NEW, ...extra })],
  ] as const) {
    test(`${name}: refused with what would be lost; confirmed for exactly that, it goes through`, async () => {
      readNow(OLD);
      assert.equal(statusOf(EVA), 'OK');

      const refused = await change({});
      assert.equal(refused.statusCode, 409, refused.body);
      assert.deepEqual(refused.json(), HAS_RESULT(OLD, 'OK', 1, topSeq()));
      assert.equal(cardOf(EVA), OLD);
      assert.equal(statusOf(EVA), 'OK');
      const seen = refused.json().lose_result;

      // A confirmation for another card, for another status, or from before
      // a read that has come in since, is not a confirmation of this.
      for (const other of [
        { ...seen, card_number: NEW },
        { ...seen, card_seq: 7 },
        { ...seen, status: 'MP' },
        { ...seen, last_read_seq: seen.last_read_seq - 1 },
      ]) {
        const res = await change({ lose_result: other });
        assert.equal(res.statusCode, 409, JSON.stringify(other));
        assert.deepEqual(res.json().lose_result, seen);
      }
      readNow(OLD);
      const stale = await change({ lose_result: seen });
      assert.equal(stale.statusCode, 409);
      assert.deepEqual(stale.json(), HAS_RESULT(OLD, 'OK', 2, topSeq()));
      assert.equal(cardOf(EVA), OLD);
      assert.equal(statusOf(EVA), 'OK');

      const body = { lose_result: stale.json().lose_result };
      const done = await change(body);
      assert.equal(done.statusCode, 200, done.body);
      assert.notEqual(cardOf(EVA), OLD);
      assert.equal(statusOf(EVA), 'PEND');

      // Twice is once: the same request again changes nothing.
      const card = cardOf(EVA);
      const again = await change(body);
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(cardOf(EVA), card);
      assert.equal(statusOf(EVA), 'PEND');

      // Taken back, the result is there again; the old confirmation is for
      // the state before the change and is not taken a second time.
      assert.equal((await edit({ card_number: OLD })).statusCode, 200);
      assert.equal(statusOf(EVA), 'OK');
      const late = await change(body);
      assert.equal(late.statusCode, 409, late.body);
      assert.equal(cardOf(EVA), OLD);
      assert.equal(statusOf(EVA), 'OK');
    });
  }

  test('"Ändra" logs the card the runner had, so the change can be undone and the result is back', async () => {
    readNow(OLD);
    const seen = (await edit({ card_number: NEW })).json().lose_result;
    const done = await edit({ card_number: NEW, lose_result: seen });
    assert.equal(done.statusCode, 200, done.body);
    const bind = ctx.handle.db
      .select()
      .from(events)
      .all()
      .find((e) => e.eventType === 'card_bound')!;
    assert.equal(
      (bind.payload as Extract<EventPayload, { event_type: 'card_bound' }>).previous_card_number,
      OLD
    );
    const back = await undo(ctx.app, { node_id: bind.nodeId, local_seq: bind.localSeq });
    assert.equal(back.statusCode, 201, back.body);
    assert.equal(cardOf(EVA), OLD);
    assert.equal(statusOf(EVA), 'OK');
  });

  test('a runner who has not read out, or whose reads are from before the race: no question', async () => {
    assert.equal((await edit({ card_number: NEW })).statusCode, 200);
    assert.equal((await replace({ card_number: OLD })).statusCode, 200);
    // Not started: a read is an identity scan and nothing is scored.
    readNow(OLD);
    ctx.handle.sqlite.prepare('UPDATE competitions SET race_started_at_ms = NULL').run();
    assert.equal(statusOf(EVA), 'PEND');
    assert.equal((await edit({ card_number: NEW })).statusCode, 200);
  });

  test('a status set by hand that a read of the new card would clear: refused, and named with no reads', async () => {
    // EVA has MAX by hand; NEW is read in a race that is then reset.
    ctx.handle.sqlite.prepare('UPDATE competitions SET race_started_at_ms = NULL').run();
    const base = `/api/competitions/${COMP}`;
    const status = await ctx.app.inject({
      method: 'POST',
      url: `${base}/competitors/${EVA}/status`,
      payload: { status: 'MAX', reason: 'över maxtid' },
    });
    assert.equal(status.statusCode, 201, status.body);
    const started = await ctx.app.inject({ method: 'POST', url: `${base}/start-race` });
    readNow(NEW, Date.now());
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `${base}/reset-race`,
      payload: { force: true, started_at_ms: started.json().race_started_at_ms },
    });
    assert.equal(reset.statusCode, 201, reset.body);
    assert.equal(statusOf(EVA), 'MAX');

    const refused = await replace({ card_number: NEW });
    assert.equal(refused.statusCode, 409, refused.body);
    assert.deepEqual(refused.json(), HAS_RESULT(OLD, 'MAX', 0, 0));
    assert.equal(statusOf(EVA), 'MAX');
    const done = await replace({ card_number: NEW, lose_result: refused.json().lose_result });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(statusOf(EVA), 'PEND');
  });

  test('undo of a card change: a status set by hand that the old card would clear is not taken without the confirmation', async () => {
    // EVA gets NEW and MAX by hand; OLD is read in a race that is then reset.
    ctx.handle.sqlite.prepare('UPDATE competitions SET race_started_at_ms = NULL').run();
    const base = `/api/competitions/${COMP}`;
    const ev = await rebind(ctx.app, EVA, NEW);
    const status = await ctx.app.inject({
      method: 'POST',
      url: `${base}/competitors/${EVA}/status`,
      payload: { status: 'MAX', reason: 'över maxtid' },
    });
    assert.equal(status.statusCode, 201, status.body);
    const started = await ctx.app.inject({ method: 'POST', url: `${base}/start-race` });
    readNow(OLD, Date.now());
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `${base}/reset-race`,
      payload: { force: true, started_at_ms: started.json().race_started_at_ms },
    });
    assert.equal(reset.statusCode, 201, reset.body);
    assert.equal(statusOf(EVA), 'MAX');

    const refused = await undo(ctx.app, ev);
    assert.equal(refused.statusCode, 409, refused.body);
    assert.deepEqual(refused.json(), HAS_RESULT(NEW, 'MAX', 0, 0, ev.local_seq));
    assert.equal(cardOf(EVA), NEW);
    assert.equal(statusOf(EVA), 'MAX');

    const done = await ctx.app.inject({
      method: 'POST',
      url: `${base}/card-binds/undo`,
      payload: {
        node_id: ev.node_id,
        local_seq: ev.local_seq,
        lose_result: refused.json().lose_result,
      },
    });
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(cardOf(EVA), OLD);
    assert.equal(statusOf(EVA), 'PEND');
  });

  test('undo of a card change: a read with the new card since is not taken without the confirmation', async () => {
    const ev = await rebind(ctx.app, EVA, NEW);
    readNow(NEW);
    assert.equal(statusOf(EVA), 'OK');

    const refused = await undo(ctx.app, ev);
    assert.equal(refused.statusCode, 409, refused.body);
    assert.deepEqual(refused.json(), HAS_RESULT(NEW, 'OK', 1, topSeq(), ev.local_seq));
    assert.equal(cardOf(EVA), NEW);
    assert.equal(statusOf(EVA), 'OK');

    readNow(NEW);
    const send = (lose: unknown) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${COMP}/card-binds/undo`,
        payload: { node_id: ev.node_id, local_seq: ev.local_seq, lose_result: lose },
      });
    const stale = await send(refused.json().lose_result);
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(stale.json(), HAS_RESULT(NEW, 'OK', 2, topSeq(), ev.local_seq));

    const done = await send(stale.json().lose_result);
    assert.equal(done.statusCode, 201, done.body);
    assert.equal(cardOf(EVA), OLD);
    assert.equal(statusOf(EVA), 'PEND');
    const again = await send(stale.json().lose_result);
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, 'already_undone');
    assert.equal(cardOf(EVA), OLD);
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

  test('a pre-race scan of the old card (registration desk) does not count as read out', async () => {
    ctx.handle.sqlite
      .prepare('UPDATE competitions SET race_started_at_ms = ? WHERE id = ?')
      .run(READ_AT_MS, COMP);
    addRunner(ctx.handle, A, 'H21', 500);
    // Identity scan of A's entered card at 07:00, before the race started.
    addRead(ctx.handle, ctx.nodeId, 500, [], true, READ_AT_MS - 4 * 3600_000);
    addRead(ctx.handle, ctx.nodeId, NEW, [31, 32, 33, 34]);
    const runners = await entries(ctx.app, NEW);
    assert.deepEqual(
      runners.map((r) => [r.competitor_id, r.suggested]),
      [[A, true]]
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
