// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the operator-attested DNF override flow:
//
//   - POST /api/competitions/:id/competitors/:competitorId/manual-dnf
//   - POST /api/competitions/:id/competitors/:competitorId/un-dnf
//
// Coverage:
//   - test 1: manual-dnf for a known competitor → 201; manual_dnf event
//     row exists; projection.competitors.get(id).status === 'DNF';
//     manual_dnf_reason equals body.reason.
//   - test 2: manual-dnf with empty reason → 400 with structured errors.
//   - test 3: manual-dnf for an unknown competitor → 404.
//   - test 4: un-dnf after manual-dnf → 201; projection status reverts
//     (PEND when no card_read exists yet).
//   - test 5: un-dnf without any prior manual_dnf → 201 (idempotent at
//     REST layer; projection re-derivation is a no-op).
//   - test 6 (T-CROSS-COMP-MANUAL): manual-dnf with a competitor id that
//     lives in a DIFFERENT competition → 404.
//   - test 7 (PATTERNS S-2 broadcast spy): manual-dnf records one envelope
//     on `readout:<comp>` with type='manual_dnf'.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-10-PLAN.md task 1

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer, type BroadcastSink } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { events } from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { ChannelName } from '@fartola/shared-types';
import { eq } from 'drizzle-orm';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  recorded: { channel: ChannelName; envelope: { type: string; payload: unknown; seq?: number } }[];
}

async function boot(): Promise<Ctx> {
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
    projectionDebounceMs: 0,
  });
  return { app, handle, recorded };
}

/** Seed a competition + class + competitor via REST so the routes exercise
 * the same validation path the integration covers. Returns the ids. */
async function seedCompetitionAndCompetitor(
  app: FastifyInstance
): Promise<{ competitionId: string; classId: string; competitorId: string }> {
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
  const competitorRes = await app.inject({
    method: 'POST',
    url: '/api/competitors',
    payload: {
      competition_id: competitionId,
      name: 'Anna Andersson',
      club: null,
      class_id: classId,
      consent: true,
    },
  });
  assert.equal(competitorRes.statusCode, 201);
  const competitorId = (competitorRes.json() as { id: string }).id;
  return { competitionId, classId, competitorId };
}

describe('POST /api/competitions/:id/competitors/:competitorId/manual-dnf', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: valid manual-dnf → 201; event row + projection status DNF + reason persisted', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/manual-dnf`,
      payload: { reason: 'Did not start' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { local_seq: number };
    assert.ok(body.local_seq > 0);

    // Event row inserted.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    const dnfRow = evtRows.find((e) => e.eventType === 'manual_dnf');
    assert.ok(dnfRow);
    assert.equal(
      (dnfRow.payload as { event_type: string; reason: string }).reason,
      'Did not start'
    );

    // Projection reflects manual override.
    const projection = ctx.app.projectionStore.recomputeNow(competitionId);
    assert.ok(projection);
    const view = projection.competitors.get(competitorId);
    assert.ok(view);
    assert.equal(view.status, 'DNF');
    assert.equal(view.manual_dnf_reason, 'Did not start');
  });

  test('test 2: manual-dnf with empty reason → 400 with structured errors', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/manual-dnf`,
      payload: { reason: '' },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { errors: { path: string }[] };
    assert.ok(body.errors.some((e) => e.path === 'reason'));
  });

  test('test 3: manual-dnf for unknown competitor → 404', async () => {
    const { competitionId } = await seedCompetitionAndCompetitor(ctx.app);
    const bogus = '00000000-0000-0000-0000-000000000000';
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${bogus}/manual-dnf`,
      payload: { reason: 'never started' },
    });
    assert.equal(res.statusCode, 404);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'competitor_not_found');
  });

  test('test 6 (T-CROSS-COMP-MANUAL): manual-dnf with competitor from a DIFFERENT competition → 404', async () => {
    const a = await seedCompetitionAndCompetitor(ctx.app);
    const b = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${a.competitionId}/competitors/${b.competitorId}/manual-dnf`,
      payload: { reason: 'spoof' },
    });
    assert.equal(res.statusCode, 404);
    // The event MUST NOT have been inserted on competition a OR competition b.
    const evtRowsA = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, a.competitionId))
      .all();
    const evtRowsB = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, b.competitionId))
      .all();
    assert.equal(evtRowsA.filter((e) => e.eventType === 'manual_dnf').length, 0);
    assert.equal(evtRowsB.filter((e) => e.eventType === 'manual_dnf').length, 0);
  });

  test('test 7 (PATTERNS S-2 broadcast spy): manual-dnf records readout:<comp> envelope', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // Drop any prior recorded envelopes (the competitor seed POST did not
    // emit a card_bound since no card_number was provided, so the buffer
    // should already be empty — assert to keep the spy contract tight).
    assert.equal(ctx.recorded.length, 0);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/manual-dnf`,
      payload: { reason: 'broke ankle' },
    });
    assert.equal(res.statusCode, 201);
    // The manual_dnf envelope MUST be present on readout:<comp>. A
    // results_update envelope MAY also be present from the markDirty
    // recompute — we filter for the manual_dnf one specifically.
    const manualEnv = ctx.recorded.find((r) => r.envelope.type === 'manual_dnf');
    assert.ok(manualEnv);
    assert.equal(manualEnv.channel, `readout:${competitionId}`);
    const payload = manualEnv.envelope.payload as { competitor_id: string; reason: string };
    assert.equal(payload.competitor_id, competitorId);
    assert.equal(payload.reason, 'broke ankle');
    assert.ok(manualEnv.envelope.seq !== undefined && manualEnv.envelope.seq > 0);
  });
});

describe('POST /api/competitions/:id/competitors/:competitorId/status (idempotency)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('Phase-2.1: POST /status with same status → 200 idempotent (no duplicate event)', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // First assertion: 201
    const res1 = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/status`,
      payload: { status: 'DNS', reason: 'no-show' },
    });
    assert.equal(res1.statusCode, 201);

    // Second identical assertion: 200 (idempotent)
    const res2 = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/status`,
      payload: { status: 'DNS', reason: 'no-show' },
    });
    assert.equal(res2.statusCode, 200);
    const body2 = res2.json() as { idempotent: boolean };
    assert.equal(body2.idempotent, true);

    // Only ONE manual_status_set event should exist.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.equal(evtRows.filter((e) => e.eventType === 'manual_status_set').length, 1);
  });

  test('Phase-2.1: POST /clear-status when already null → 200 idempotent', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // No manual status set → manual_status is null → should be idempotent
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/clear-status`,
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { idempotent: boolean };
    assert.equal(body.idempotent, true);

    // No clear_manual_status event should exist.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.equal(evtRows.filter((e) => e.eventType === 'clear_manual_status').length, 0);
  });

  test('Phase-2.1: POST /clear-status rejects unexpected body fields (strict)', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/clear-status`,
      payload: { unexpected_field: 'oops' },
    });
    assert.equal(res.statusCode, 400);
  });
});

// 02.1-14 Task 10: the secretariat can set "Felstämplad" (MP) by hand, e.g.
// for a runner who went home without reading out (MeOS allows it).
describe('POST /api/competitions/:id/competitors/:competitorId/status MP (02.1-14 Task 10)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('MP is accepted → 201 and the projection shows MP', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/status`,
      payload: { status: 'MP', reason: 'Gick hem utan att läsa ut' },
    });
    assert.equal(res.statusCode, 201);
    const view = ctx.app.projectionStore.recomputeNow(competitionId)?.competitors.get(competitorId);
    assert.equal(view?.status, 'MP');
    assert.equal(view?.manual_status, 'MP');
  });
});

describe('POST /api/competitions/:id/competitors/:competitorId/void-leg', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('Phase-2.1: void-leg → 201 with leg_voided event; projection.voided_legs contains code', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/void-leg`,
      payload: { control_code: 42 },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { local_seq: number };
    assert.ok(body.local_seq > 0);

    // Event row inserted.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    const voidRow = evtRows.find((e) => e.eventType === 'leg_voided');
    assert.ok(voidRow);
    const payload = voidRow.payload as { control_code: number; max_seconds?: unknown };
    assert.equal(payload.control_code, 42);
    assert.equal('max_seconds' in payload, false);

    // Projection reflects voided leg.
    const projection = ctx.app.projectionStore.recomputeNow(competitionId);
    const view = projection?.competitors.get(competitorId);
    assert.ok(view);
    assert.deepEqual(view.voided_legs, [42]);
  });

  test('Phase-2.1: void-leg with invalid body → 400', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/void-leg`,
      payload: { control_code: 'not-a-number' },
    });
    assert.equal(res.statusCode, 400);
  });

  // SOFT TR 4.20.10 (2026-07-01): results may not be built from split
  // times, so a voided leg never shortens the running time and the route
  // no longer takes a time cap. A caller still sending one gets 400
  // instead of a silently ignored field.
  test('void-leg with a max_seconds time cap → 400 (TR 4.20.10)', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/void-leg`,
      payload: { control_code: 42, max_seconds: 60 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('Phase-2.1: void-leg for unknown competitor → 404', async () => {
    const { competitionId } = await seedCompetitionAndCompetitor(ctx.app);
    const bogus = '00000000-0000-0000-0000-000000000000';
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${bogus}/void-leg`,
      payload: { control_code: 31 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('Phase-2.1: unvoid-leg → 201 with leg_unvoided event; voided_legs cleared', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // First void.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/void-leg`,
      payload: { control_code: 42 },
    });
    // Then unvoid.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/unvoid-leg`,
      payload: { control_code: 42 },
    });
    assert.equal(res.statusCode, 201);

    const projection = ctx.app.projectionStore.recomputeNow(competitionId);
    const view = projection?.competitors.get(competitorId);
    assert.ok(view);
    assert.deepEqual(view.voided_legs, []);
  });
});

describe('POST /api/competitions/:id/competitors/:competitorId/un-dnf', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 4: un-dnf after manual-dnf → 201; projection reverts to PEND (no card_read)', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // First DNF the competitor.
    const dnfRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/manual-dnf`,
      payload: { reason: 'mistake' },
    });
    assert.equal(dnfRes.statusCode, 201);
    let projection = ctx.app.projectionStore.recomputeNow(competitionId);
    assert.equal(projection?.competitors.get(competitorId)?.status, 'DNF');

    // Now un-DNF.
    const unRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/un-dnf`,
      payload: {},
    });
    assert.equal(unRes.statusCode, 201);
    projection = ctx.app.projectionStore.recomputeNow(competitionId);
    const view = projection?.competitors.get(competitorId);
    assert.ok(view);
    // No card_read has landed for this competitor, so the re-derivation is PEND.
    assert.equal(view.status, 'PEND');
    assert.equal(view.manual_dnf_reason, null);

    // Both events persisted.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.ok(evtRows.some((e) => e.eventType === 'manual_dnf'));
    assert.ok(evtRows.some((e) => e.eventType === 'un_dnf'));
  });

  test('test 5: un-dnf without prior manual_dnf → 201 (idempotent at REST layer)', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/un-dnf`,
      payload: {},
    });
    assert.equal(res.statusCode, 201);
    // un_dnf event persisted regardless.
    const evtRows = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all();
    assert.equal(evtRows.filter((e) => e.eventType === 'un_dnf').length, 1);
    // Projection unaffected — competitor is still PEND.
    const projection = ctx.app.projectionStore.recomputeNow(competitionId);
    assert.equal(projection?.competitors.get(competitorId)?.status, 'PEND');
  });

  test('un-dnf for unknown competitor → 404 (T-CROSS-COMP-MANUAL guard mirror)', async () => {
    const { competitionId } = await seedCompetitionAndCompetitor(ctx.app);
    const bogus = '00000000-0000-0000-0000-000000000000';
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${bogus}/un-dnf`,
      payload: {},
    });
    assert.equal(res.statusCode, 404);
  });
});

// SOFT TA till TR 7.8.2: unread is not "not started". The operator sets the
// runners with no read-out and no status to DNS ("Ej start") — MeOS "Sätt
// okända löpare utan registrering till <Ej Start>" (TabRunner.cpp:974-986)
// — and can undo exactly those.
describe('POST /api/competitions/:id/unread-dns (+ /undo)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('SOFT TA till TR 7.8.2: "Sätt ej utlästa till Ej start" sets DNS only for unread runners without a status; undo clears exactly those; the final export follows', async () => {
    const { competitionId, classId } = await seedCompetitionAndCompetitor(ctx.app);
    const add = async (name: string, card: number | null): Promise<string> => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: {
          competition_id: competitionId,
          name,
          club: null,
          class_id: classId,
          card_number: card,
          consent: true,
        },
      });
      assert.equal(res.statusCode, 201);
      return (res.json() as { id: string }).id;
    };
    const read = await add('Lisa Lastrup', 101);
    const unread = await add('Olle Olast', 102);
    const dnf = await add('Bror Brot', null);
    const ownDns = await add('Ebba Egen', null);
    const setStatus = (id: string, status: string, reason: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${competitionId}/competitors/${id}/status`,
        payload: { status, reason },
      });
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/competitions/${competitionId}/start-race`,
        })
      ).statusCode,
      201
    );
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'test-node',
        localSeq: 9001,
        competitionId,
        eventType: 'card_read',
        eventTimeMs: Date.now() + 1000,
        recordedAtMs: Date.now() + 1000,
        payload: {
          event_type: 'card_read',
          card_number: 101,
          card_type: 'SI10',
          start: { half_day: 0, seconds_in_half_day: 9 * 3600, weekday: null },
          finish: { half_day: 0, seconds_in_half_day: 9 * 3600 + 1800, weekday: null },
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
    assert.equal((await setStatus(dnf, 'DNF', 'Bröt vid 3:an')).statusCode, 201);
    assert.equal((await setStatus(ownDns, 'DNS', 'Återbud vid starten')).statusCode, 201);

    const view = (id: string) =>
      ctx.app.projectionStore.recomputeNow(competitionId)!.competitors.get(id)!;
    const pending = async (): Promise<number> => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${competitionId}/export/preview?status=Final`,
      });
      return (res.json() as { summary: { pending_count: number } }).summary.pending_count;
    };
    const finalXml = async (): Promise<string> =>
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/competitions/${competitionId}/export?format=iof30&status=Final`,
        })
      ).body;
    const statusOf = (xml: string, family: string): string | null => {
      const at = xml.indexOf(`<Family>${family}</Family>`);
      if (at === -1) return null;
      return /<Status>(\w+)<\/Status>/.exec(xml.slice(at))![1]!;
    };

    // Before: the unread runner (and the seeded Anna, also unread) are left
    // out of the final list and counted.
    assert.equal(view(unread).status, 'PEND');
    assert.equal(await pending(), 2);
    assert.equal(statusOf(await finalXml(), 'Olast'), null);

    const set = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/unread-dns`,
    });
    assert.equal(set.statusCode, 201);
    assert.equal((set.json() as { count: number }).count, 2);
    assert.equal(view(unread).status, 'DNS');
    assert.equal(view(unread).manual_dnf_reason, 'Ej utläst: satt till Ej start');
    assert.equal(view(read).status, 'OK');
    assert.equal(view(dnf).status, 'DNF');
    assert.equal(view(ownDns).manual_dnf_reason, 'Återbud vid starten');
    assert.equal(await pending(), 0);
    let xml = await finalXml();
    assert.equal(statusOf(xml, 'Olast'), 'DidNotStart');
    assert.equal(statusOf(xml, 'Lastrup'), 'OK');
    assert.equal(statusOf(xml, 'Brot'), 'DidNotFinish');

    const undo = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/unread-dns/undo`,
    });
    assert.equal(undo.statusCode, 201);
    assert.equal((undo.json() as { count: number }).count, 2);
    assert.equal(view(unread).status, 'PEND');
    assert.equal(view(ownDns).status, 'DNS', "the operator's own DNS stays");
    assert.equal(view(dnf).status, 'DNF');
    assert.equal(await pending(), 2);
    xml = await finalXml();
    assert.equal(statusOf(xml, 'Olast'), null);
    assert.equal(statusOf(xml, 'Egen'), 'DidNotStart');
  });
});
