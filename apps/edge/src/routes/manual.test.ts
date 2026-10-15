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
import { formatClockTime, type ChannelName } from '@fartola/shared-types';
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
    // The competitor seed POST did not emit a card_bound since no
    // card_number was provided — assert to keep the spy contract tight. A
    // results_update from the seed's markDirty may have arrived already.
    assert.equal(ctx.recorded.filter((r) => r.envelope.type !== 'results_update').length, 0);
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

describe('POST …/competitors/:competitorId/manual-finish (SOFT TR 4.20.6)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });
  const FINISH_MS = Date.UTC(2026, 4, 22, 9, 40);
  const post = (competitionId: string, competitorId: string, path: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/${path}`,
      payload: payload as object,
    });

  test('set → 201, a manual_finish_set event, the projection has the finish and reason; clear removes it', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await post(competitionId, competitorId, 'manual-finish', {
      finish_ms: FINISH_MS,
      reason: 'Målenheten stod still',
    });
    assert.equal(res.statusCode, 201);
    const row = ctx.handle.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .all()
      .find((e) => e.eventType === 'manual_finish_set');
    assert.ok(row);
    const view = ctx.app.projectionStore
      .recomputeNow(competitionId)!
      .competitors.get(competitorId)!;
    assert.equal(view.manual_finish_ms, FINISH_MS);
    assert.equal(view.manual_finish_reason, 'Målenheten stod still');
    assert.ok(
      ctx.recorded.some(
        (r) => r.channel === `readout:${competitionId}` && r.envelope.type === 'manual_finish_set'
      )
    );

    const cleared = await post(competitionId, competitorId, 'clear-manual-finish', {});
    assert.equal(cleared.statusCode, 201);
    const after = ctx.app.projectionStore
      .recomputeNow(competitionId)!
      .competitors.get(competitorId)!;
    assert.equal(after.manual_finish_ms, null);
  });

  test('ADR-0017: changing the clock offset keeps the finish on its clock time, with its reason', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // 11:40 on the competition clock at +120 (2026-05-22 is CEST).
    await post(competitionId, competitorId, 'manual-finish', {
      finish_ms: FINISH_MS,
      reason: 'Enheten',
    });
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${competitionId}`,
      payload: { clock_offset_min: 180 },
    });
    assert.equal(patch.statusCode, 200);
    const view = ctx.app.projectionStore
      .recomputeNow(competitionId)!
      .competitors.get(competitorId)!;
    assert.equal(view.manual_finish_ms, FINISH_MS - 60 * 60_000);
    assert.equal(formatClockTime(view.manual_finish_ms!, 180), formatClockTime(FINISH_MS, 120));
    assert.equal(view.manual_finish_reason, 'Enheten');
  });

  test('no reason, an empty reason or no finish → 400; clear with a body field → 400', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    for (const body of [
      { finish_ms: FINISH_MS },
      { finish_ms: FINISH_MS, reason: '' },
      { reason: 'x' },
      { finish_ms: 'tio', reason: 'x' },
    ]) {
      assert.equal(
        (await post(competitionId, competitorId, 'manual-finish', body)).statusCode,
        400
      );
    }
    const res = await post(competitionId, competitorId, 'clear-manual-finish', { x: 1 });
    assert.equal(res.statusCode, 400);
  });

  test('GET …/corrections shows the corrections in force; another competition → 404', async () => {
    const a = await seedCompetitionAndCompetitor(ctx.app);
    await post(a.competitionId, a.competitorId, 'manual-finish', {
      finish_ms: FINISH_MS,
      reason: 'Enheten',
    });
    const get = (competitionId: string, competitorId: string) =>
      ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${competitionId}/competitors/${competitorId}/corrections`,
      });
    const res = await get(a.competitionId, a.competitorId);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      status: 'PEND',
      elapsed_time_ms: null,
      start_ms: null,
      read_at_ms: null,
      drawn_start_ms: null,
      late_start_ms: null,
      read_count: 0,
      start_source: null,
      latest_read: null,
      missing_codes: [],
      manual_finish_ms: FINISH_MS,
      manual_finish_reason: 'Enheten',
      manual_punches: [],
      time_addition_min: 0,
      time_addition_reason: null,
      start_method: 'free_start',
    });
    const b = await seedCompetitionAndCompetitor(ctx.app);
    assert.equal((await get(a.competitionId, b.competitorId)).statusCode, 404);
  });

  test('GET …/corrections start_ms is the start the time runs from (start_punch: the punch)', async () => {
    const { competitionId, classId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    // Drawn 10:00, punched 09:50 (CEST, 2026-05-22), read 10:30.
    ctx.handle.sqlite
      .prepare('UPDATE competitors SET card_number = 501, start_time_ms = ? WHERE id = ?')
      .run(Date.UTC(2026, 4, 22, 8, 0), competitorId);
    ctx.handle.sqlite
      .prepare('UPDATE classes SET start_method = ? WHERE id = ?')
      .run('start_punch', classId);
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'test',
        localSeq: 1,
        competitionId,
        eventType: 'card_read',
        eventTimeMs: Date.UTC(2026, 4, 22, 8, 30),
        recordedAtMs: Date.UTC(2026, 4, 22, 8, 30),
        payload: {
          event_type: 'card_read',
          card_number: 501,
          card_type: 'SI10',
          start: { seconds_in_half_day: 9 * 3600 + 50 * 60, half_day: 0, weekday: null },
          finish: null,
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/corrections`,
    });
    assert.equal((res.json() as { start_ms: number }).start_ms, Date.UTC(2026, 4, 22, 7, 50));
  });

  test('GET …/corrections has the latest read, the read count, the drawn start and the late start', async () => {
    // Drawn 10:00 (CEST, 2026-05-22); a start punch at 10:00:00 + offset.
    const DRAWN = Date.UTC(2026, 4, 22, 8, 0);
    let seq = 100;
    const run = async (startMethod: string, punchOffsetSec: number) => {
      const { competitionId, classId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
      ctx.handle.sqlite
        .prepare('UPDATE competitors SET card_number = 501, start_time_ms = ? WHERE id = ?')
        .run(DRAWN, competitorId);
      ctx.handle.sqlite
        .prepare('UPDATE classes SET start_method = ? WHERE id = ?')
        .run(startMethod, classId);
      ctx.handle.sqlite
        .prepare('UPDATE competitions SET race_started_at_ms = 1 WHERE id = ?')
        .run(competitionId);
      const startSec = 10 * 3600 + punchOffsetSec;
      ctx.handle.db
        .insert(events)
        .values({
          nodeId: 'test',
          localSeq: ++seq,
          competitionId,
          eventType: 'card_read',
          eventTimeMs: DRAWN + 30 * 60_000,
          recordedAtMs: DRAWN + 30 * 60_000,
          payload: {
            event_type: 'card_read',
            card_number: 501,
            card_type: 'SI10',
            start: { seconds_in_half_day: startSec, half_day: 0, weekday: null },
            finish: { seconds_in_half_day: 10 * 3600 + 1200, half_day: 0, weekday: null },
            check: null,
            clear: null,
            punch_count: 1,
            punches: [
              { code: 31, seconds_in_half_day: startSec + 300, half_day: 0, weekday: null },
            ],
            card_holder: null,
          },
        })
        .run();
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${competitionId}/competitors/${competitorId}/corrections`,
      });
      return res.json() as {
        drawn_start_ms: number | null;
        late_start_ms: number | null;
        read_count: number;
        latest_read: {
          card_type: string;
          punches: Array<{ code: number }>;
          start: { seconds_in_half_day: number } | null;
          finish: { seconds_in_half_day: number } | null;
        } | null;
      };
    };
    const onTime = await run('auto', 60);
    assert.equal(onTime.late_start_ms, null, 'exactly 60 s is not late');
    assert.equal(onTime.drawn_start_ms, DRAWN);
    assert.equal(onTime.read_count, 1);
    assert.equal(onTime.latest_read?.card_type, 'SI10');
    assert.deepEqual(
      onTime.latest_read?.punches.map((p) => p.code),
      [31]
    );
    assert.equal(onTime.latest_read?.start?.seconds_in_half_day, 10 * 3600 + 60);
    assert.equal(onTime.latest_read?.finish?.seconds_in_half_day, 10 * 3600 + 1200);
    assert.equal((await run('auto', 61)).late_start_ms, 61_000, '61 s is late');
    assert.equal((await run('start_punch', 192)).late_start_ms, null, 'none for start_punch');
  });

  test('GET …/corrections: a pre-race scan is no read; an SI5 afternoon clock is placed; start_source follows the start method', async () => {
    // 2026-05-22 is CEST (+120): 14:00 local = 12:00 UTC.
    const DRAWN = Date.UTC(2026, 4, 22, 12, 0);
    let seq = 300;
    const run = async (opts: {
      startMethod?: string;
      raceStart: number | null;
      drawn: number | null;
      cardType: string;
      readAt: number;
    }) => {
      const { competitionId, classId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
      ctx.handle.sqlite
        .prepare('UPDATE competitors SET card_number = 502, start_time_ms = ? WHERE id = ?')
        .run(opts.drawn, competitorId);
      ctx.handle.sqlite
        .prepare('UPDATE classes SET start_method = ? WHERE id = ?')
        .run(opts.startMethod ?? 'auto', classId);
      ctx.handle.sqlite
        .prepare('UPDATE competitions SET race_started_at_ms = ? WHERE id = ?')
        .run(opts.raceStart, competitionId);
      // SI5 has no PM bit: 14:05 is half_day 0, 02:05 into the half day.
      const clk = (s: number) => ({ seconds_in_half_day: s, half_day: 0 as const, weekday: null });
      ctx.handle.db
        .insert(events)
        .values({
          nodeId: 'test',
          localSeq: ++seq,
          competitionId,
          eventType: 'card_read',
          eventTimeMs: opts.readAt,
          recordedAtMs: opts.readAt,
          payload: {
            event_type: 'card_read',
            card_number: 502,
            card_type: opts.cardType,
            start: clk(2 * 3600 + 5 * 60),
            finish: clk(2 * 3600 + 25 * 60),
            check: null,
            clear: null,
            punch_count: 1,
            punches: [{ code: 31, ...clk(2 * 3600 + 10 * 60) }],
            card_holder: null,
          },
        })
        .run();
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/competitions/${competitionId}/competitors/${competitorId}/corrections`,
      });
      return res.json() as {
        read_count: number;
        start_source: string | null;
        latest_read: {
          read_at_ms: number;
          start_ms: number | null;
          finish_ms: number | null;
        } | null;
      };
    };
    const READ_AT = DRAWN + 30 * 60_000;
    // Before the race started: not a read.
    const pre = await run({
      raceStart: READ_AT + 1,
      drawn: DRAWN,
      cardType: 'SI10',
      readAt: READ_AT,
    });
    assert.equal(pre.latest_read, null);
    assert.equal(pre.read_count, 0);
    // SI5 at 14:05 local (12:05 UTC), not 02:05.
    const si5 = await run({ raceStart: 1, drawn: DRAWN, cardType: 'SI5', readAt: READ_AT });
    assert.equal(si5.read_count, 1);
    assert.equal(si5.latest_read?.read_at_ms, READ_AT);
    assert.equal(si5.latest_read?.start_ms, Date.UTC(2026, 4, 22, 12, 5));
    assert.equal(si5.latest_read?.finish_ms, Date.UTC(2026, 4, 22, 12, 25));
    // start_source by method, with a drawn start and a start punch.
    const src = async (startMethod: string, drawn: number | null) =>
      (await run({ startMethod, raceStart: 1, drawn, cardType: 'SI5', readAt: READ_AT }))
        .start_source;
    assert.equal(await src('start_time', DRAWN), 'drawn');
    assert.equal(await src('start_time', null), null);
    assert.equal(await src('start_punch', DRAWN), 'punch');
    assert.equal(await src('auto', DRAWN), 'drawn');
    assert.equal(await src('auto', null), 'punch');
  });

  test('a competitor in another competition → 404', async () => {
    const a = await seedCompetitionAndCompetitor(ctx.app);
    const b = await seedCompetitionAndCompetitor(ctx.app);
    const res = await post(a.competitionId, b.competitorId, 'manual-finish', {
      finish_ms: FINISH_MS,
      reason: 'x',
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('POST …/competitors/:competitorId/manual-punch (SOFT TR 8.1.4)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });
  const post = (competitionId: string, competitorId: string, path: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/${path}`,
      payload: payload as object,
    });

  test('add → 201 and the projection lists it; remove takes it away', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const res = await post(competitionId, competitorId, 'manual-punch', {
      control_code: 32,
      reason: 'Stiftklämma på startkortet',
    });
    assert.equal(res.statusCode, 201);
    const view = () =>
      ctx.app.projectionStore.recomputeNow(competitionId)!.competitors.get(competitorId)!;
    assert.deepEqual(view().manual_punches, [
      { control_code: 32, reason: 'Stiftklämma på startkortet' },
    ]);
    const removed = await post(competitionId, competitorId, 'remove-manual-punch', {
      control_code: 32,
    });
    assert.equal(removed.statusCode, 201);
    assert.deepEqual(view().manual_punches, []);
  });

  test('no reason or a bad code → 400; another competition → 404', async () => {
    const a = await seedCompetitionAndCompetitor(ctx.app);
    for (const body of [{ control_code: 32 }, { control_code: 0, reason: 'x' }]) {
      assert.equal(
        (await post(a.competitionId, a.competitorId, 'manual-punch', body)).statusCode,
        400
      );
    }
    const b = await seedCompetitionAndCompetitor(ctx.app);
    const res = await post(a.competitionId, b.competitorId, 'manual-punch', {
      control_code: 32,
      reason: 'x',
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('POST …/competitors/:competitorId/time-addition (SOFT TR 10.4.2)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });
  const post = (competitionId: string, competitorId: string, path: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${competitionId}/competitors/${competitorId}/${path}`,
      payload: payload as object,
    });

  test('1–5 whole minutes with a reason → 201; clear → 0', async () => {
    const { competitionId, competitorId } = await seedCompetitionAndCompetitor(ctx.app);
    const view = () =>
      ctx.app.projectionStore.recomputeNow(competitionId)!.competitors.get(competitorId)!;
    const res = await post(competitionId, competitorId, 'time-addition', {
      minutes: 1,
      reason: 'Tjuvstart',
    });
    assert.equal(res.statusCode, 201);
    assert.equal(view().time_addition_min, 1);
    assert.equal(view().time_addition_reason, 'Tjuvstart');
    assert.equal(
      (await post(competitionId, competitorId, 'clear-time-addition', {})).statusCode,
      201
    );
    assert.equal(view().time_addition_min, 0);
  });

  test('0, 6 or 1.5 minutes, or no reason → 400; another competition → 404', async () => {
    const a = await seedCompetitionAndCompetitor(ctx.app);
    for (const body of [
      { minutes: 0, reason: 'x' },
      { minutes: 6, reason: 'x' },
      { minutes: 1.5, reason: 'x' },
      { minutes: 1 },
    ]) {
      assert.equal(
        (await post(a.competitionId, a.competitorId, 'time-addition', body)).statusCode,
        400
      );
    }
    const b = await seedCompetitionAndCompetitor(ctx.app);
    const res = await post(a.competitionId, b.competitorId, 'time-addition', {
      minutes: 1,
      reason: 'x',
    });
    assert.equal(res.statusCode, 404);
  });
});
