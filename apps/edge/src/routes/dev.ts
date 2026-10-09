// Authored for fartola. Not ported from upstream.
//
// Development-only routes — registered ONLY when process.env.FARTOLA_DEV
// equals '1'. In production builds the plugin is still mounted by
// server.ts but the route registration short-circuits at the env check
// (T-DEV-ENDPOINT mitigation). The Fastify @fastify/sensible 404 handler
// then returns `{ error: 'Not found' }` for any /api/__dev/* path —
// indistinguishable from "no such endpoint."
//
// /api/__dev/simulate-read is the walking-skeleton + bridge-parity vertical:
//   - inserts a card_read event into the events table via the SINGLE
//     `insertEvent` helper (apps/edge/src/si/eventInserter.ts) — same path
//     the real SI bridge uses, so seq + recorded_at_ms semantics are
//     identical between dev and prod inputs.
//   - emits a payload in the FULL CardReadEvent shape — check/clear always
//     null (no real card here), card_holder null, punch_count equal to
//     punches.length. start + finish default to null (→ DNF in the reducer)
//     but tests that need a non-DNF projected status (e.g. the manual-DNF
//     flow which has to start from OK/MP to surface the reason input) can
//     pass them explicitly as HalfDayClock objects in the body. Plan 06
//     codex C-H2: the wire shape is consistent with what the real bridge
//     writes; plan 07's reducer needs no special-case branch for dev
//     payloads. WR-005 (Wave 5 review): the optional start/finish fields
//     are the seam that lets e2e specs avoid the synthetic-DNF foot-gun.
//   - broadcasts via WS readout:<competition_id> with seq populated.
//   - calls printerSink.print() so the stdout sink emits one JSON line; a
//     sink that fails on this partial envelope does not fail the read.
//
// Walking-skeleton convenience: if `competition_id` is unknown the route
// auto-seeds the competition row so the FK accepts the events insert. Plan
// 11's three-click wizard + plan 06's bin/fartola.ts replace this with a
// "competition must exist" check on the real path.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-06-PLAN.md task 2
//   (refactor to use insertEvent + full CardReadEvent payload shape)
// - .planning/phases/01-single-laptop-training-mvp/01-03-PLAN.md task 2
//   (original walking-skeleton wiring)
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { competitions } from '../db/schema.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { ingestEventorCache } from '../eventor/cache.ts';
import { readoutChannel } from '@fartola/shared-types';
import { eq } from 'drizzle-orm';
import type { EventPayload } from '../db/schema.ts';
import type { NdjsonPunch, HalfDayClock } from '@fartola/sportident';

interface SimulateReadBody {
  competition_id?: unknown;
  card_number?: unknown;
  card_type?: unknown;
  punches?: unknown;
  start?: unknown;
  finish?: unknown;
}

interface SimulatePunch {
  control_code: number;
  time_ms: number | null;
}

function validateHalfDayClock(v: unknown): HalfDayClock | null | undefined {
  // undefined → field absent (back-compat); null → explicit null; otherwise validate shape.
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'object') return undefined;
  const obj = v as { seconds_in_half_day?: unknown; half_day?: unknown; weekday?: unknown };
  if (typeof obj.seconds_in_half_day !== 'number' || !Number.isInteger(obj.seconds_in_half_day)) {
    return undefined;
  }
  if (obj.half_day !== 0 && obj.half_day !== 1) return undefined;
  if (obj.weekday !== null && (typeof obj.weekday !== 'number' || !Number.isInteger(obj.weekday))) {
    return undefined;
  }
  return {
    seconds_in_half_day: obj.seconds_in_half_day,
    half_day: obj.half_day,
    weekday: obj.weekday as number | null,
  };
}

function validateBody(body: SimulateReadBody): {
  competition_id: string;
  card_number: number;
  card_type: string;
  punches: SimulatePunch[];
  start: HalfDayClock | null;
  finish: HalfDayClock | null;
} | null {
  if (typeof body.competition_id !== 'string' || body.competition_id.length === 0) return null;
  if (
    typeof body.card_number !== 'number' ||
    !Number.isInteger(body.card_number) ||
    body.card_number < 0
  ) {
    return null;
  }
  if (typeof body.card_type !== 'string' || body.card_type.length === 0) return null;
  if (!Array.isArray(body.punches)) return null;
  const punches: SimulatePunch[] = [];
  for (const p of body.punches) {
    if (!p || typeof p !== 'object') return null;
    const pp = p as { control_code?: unknown; time_ms?: unknown };
    if (typeof pp.control_code !== 'number' || !Number.isInteger(pp.control_code)) return null;
    if (pp.time_ms !== null && (typeof pp.time_ms !== 'number' || !Number.isInteger(pp.time_ms))) {
      return null;
    }
    punches.push({ control_code: pp.control_code, time_ms: pp.time_ms as number | null });
  }
  // Optional HalfDayClock fields — absent or invalid → null (back-compat with
  // existing callers that don't send start/finish). Tests that need a
  // non-DNF projected status (e.g. the manual-DNF reason-input flow) send
  // both start and finish explicitly.
  const startRaw = validateHalfDayClock(body.start);
  const finishRaw = validateHalfDayClock(body.finish);
  return {
    competition_id: body.competition_id,
    card_number: body.card_number,
    card_type: body.card_type,
    punches,
    start: startRaw === undefined ? null : startRaw,
    finish: finishRaw === undefined ? null : finishRaw,
  };
}

export default async function registerDevRoutes(app: FastifyInstance): Promise<void> {
  // T-DEV-ENDPOINT: refuse to register routes outside of dev. The plugin
  // mounts but adds no handlers, so /api/__dev/* paths return the standard
  // 404. Test 2 in dev.test.ts asserts this gate.
  if (process.env['FARTOLA_DEV'] !== '1') return;

  app.post('/api/__dev/simulate-read', async (req, reply) => {
    const validated = validateBody(req.body as SimulateReadBody);
    if (!validated) {
      return reply.code(400).send({ error: 'invalid simulate-read body' });
    }

    const eventTimeMs = Date.now();

    // Walking-skeleton convenience: auto-create the competition row if
    // the operator hasn't run the three-click wizard yet. Without this
    // the events.competition_id FK fails. Plan 11's wizard replaces this
    // with a real "competition must exist" check.
    const existing = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, validated.competition_id))
      .get();
    if (!existing) {
      app.fartolaDb.db
        .insert(competitions)
        .values({
          id: validated.competition_id,
          name: `Walking-skeleton ${validated.competition_id}`,
          date: new Date(eventTimeMs).toISOString().slice(0, 10),
          createdAtMs: eventTimeMs,
        })
        .run();
    }

    // Build the dev-path CardReadEvent payload. start/finish/check/clear are
    // null because there's no real card here — the synthetic input has
    // control_code + an optional time_ms only. punches are mapped onto the
    // NdjsonPunch shape so the column stays a valid CardReadEvent (plan 07
    // reducer reads payload.punches[].code without branching on origin).
    const punches: NdjsonPunch[] = validated.punches.map((p) => ({
      code: p.control_code,
      seconds_in_half_day: p.time_ms === null ? 0 : Math.max(0, Math.floor(p.time_ms / 1000)),
      half_day: 0,
      weekday: null,
    }));
    const payload: EventPayload = {
      event_type: 'card_read',
      card_number: validated.card_number,
      card_type: validated.card_type,
      start: validated.start,
      finish: validated.finish,
      check: null,
      clear: null,
      punch_count: punches.length,
      punches,
      card_holder: null,
    };

    // Single insertion path — same helper the real SI bridge uses.
    const inserted = insertEvent(
      app.fartolaDb,
      app.fartolaNodeId,
      'card_read',
      eventTimeMs,
      payload,
      validated.competition_id
    );

    // Broadcast to the readout: channel so the SvelteKit walking-skeleton
    // page renders the card_read live. Dev simulate-read always knows the
    // competition_id explicitly — the channel is built from the body, not
    // from app.activeCompetitionId.
    app.wsBroadcast(readoutChannel(validated.competition_id), {
      type: 'card_read',
      payload,
      seq: inserted.local_seq,
    });

    // Plan 08: mark the projection dirty so the results: channel re-
    // broadcasts within the debounce window + GET /api/competitions/:id/
    // results reflects the new card_read on next read. Dev simulate-read
    // doesn't gate on app.activeCompetitionId — the body's competition_id
    // is the explicit target.
    app.projectionStore.markDirty(validated.competition_id);

    // Walking-skeleton "thermal print" — stdout-sink writes one JSON line.
    // Best effort: this envelope carries only the punches, which a real sink
    // (CUPS, ESC/POS) can't render into a receipt; the read itself has landed.
    try {
      await app.printerSink.print({
        template: 'classic',
        competition_id: validated.competition_id,
        card_number: validated.card_number,
        data: { punches: validated.punches },
      });
    } catch (err) {
      app.log.warn({ err }, 'simulate-read: dev print failed');
    }

    return reply.code(201).send({ local_seq: inserted.local_seq, broadcasted: true });
  });

  // Phase 2.0 Plan 02-02 task 5 — seed the Eventor cache from the bundled
  // Plan-01 fixture so e2e specs have deterministic data without
  // round-tripping the Eventor API. Same FARTOLA_DEV gate as the rest of
  // /api/__dev/*.
  app.post('/api/__dev/eventor-seed', async (_req, reply) => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      // routes/dev.ts -> eventor/__fixtures__/
      const fixDir = path.resolve(here, '..', 'eventor', '__fixtures__');
      const competitorsXml = path.join(fixDir, 'competitors-sample.xml');
      const clubsXml = path.join(fixDir, 'clubs-sample.xml');
      const result = await ingestEventorCache(app.fartolaDb, competitorsXml, clubsXml, Date.now());
      return reply.code(200).send({ ok: true, ...result });
    } catch (err) {
      app.log.error({ err }, 'eventor-seed failed');
      return reply.code(500).send({ ok: false, error: (err as Error).message });
    }
  });
}
