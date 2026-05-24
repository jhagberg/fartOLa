// Authored for fartola. Not ported from upstream.
//
// REST routes for the operator-attested DNF override flow:
//
//   - POST /api/competitions/:id/competitors/:competitorId/manual-dnf
//   - POST /api/competitions/:id/competitors/:competitorId/un-dnf
//
// Both endpoints:
//   1. Verify the competitor exists AND belongs to :id (the competition).
//      Cross-competition reject is the T-CROSS-COMP-MANUAL mitigation —
//      404 is returned even if the competitor exists in some other
//      competition. The plan-07 reducer is per-competition so a
//      mis-targeted event would never reach the wrong projection, but the
//      pre-flight check keeps the API surface tight and the response
//      shape consistent.
//   2. Insert an event row via the shared `insertEvent` helper (plan 06)
//      so node_id + local_seq monotonicity is preserved (REQ-EVT-003).
//   3. Broadcast a `manual_dnf` / `un_dnf` envelope on `readout:<id>` so
//      the SPA readout view (plan 13) updates the row inline.
//   4. Call `projectionStore.markDirty(competitionId)` so the per-class
//      results channel reflects the new status after the debounced
//      recompute.
//
// Manual-DNF semantics live in the reducer (plan 07 / projection/reduce.ts):
//   - manual_dnf: forces status='DNF' and stores manual_dnf_reason. A
//     subsequent card_read does NOT overwrite the status (the override
//     wins until un_dnf clears it).
//   - un_dnf: clears the override and re-derives status from
//     latest_punches (PEND if no card_read, OK/MP otherwise).
//
// The un-dnf endpoint is intentionally idempotent at the REST layer — it
// returns 201 even when the competitor has no prior manual_dnf event,
// because the projection re-derivation is a no-op in that case. The
// alternative (404 / 409 on missing override) would require the reducer's
// state to be queryable from the route, which Phase 1 does not need.
//
// REQ-EVT-CMP-006 D-12: DNF/MP detection allows a manual override path;
// plan 07 reduce already handles `manual_dnf` + `un_dnf` event arms.
// UI-SPEC §"Destructive actions": Manual DNF popover is reversible via
// un_dnf — no irreversible mutations in Phase 1.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-10-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Manual DNF override" (reversible; reason field 1..500 chars)
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-12
// - REQ-EVT-CMP-006 (DNF/MP from event log + manual override path)

import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';

import {
  ManualDnfInput,
  ManualStatusInput,
  VoidLegInput,
  UnvoidLegInput,
  readoutChannel,
} from '@fartola/shared-types';
import { competitors as competitorsTable } from '../db/schema.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { issuesToErrors } from './_zod-errors.ts';

export default async function registerManualRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/manual-dnf',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const parsed = ManualDnfInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'manual_dnf',
        Date.now(),
        { event_type: 'manual_dnf', competitor_id: competitorId, reason: parsed.data.reason },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'manual_dnf',
        payload: { competitor_id: competitorId, reason: parsed.data.reason },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );

  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/un-dnf',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'un_dnf',
        Date.now(),
        { event_type: 'un_dnf', competitor_id: competitorId },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'un_dnf',
        payload: { competitor_id: competitorId },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 2.0 — generalized manual-status override.
  //
  //   POST /api/competitions/:id/competitors/:competitorId/status
  //        body: { status: 'DNF'|'DNS'|'DQ'|'CANCEL'|'MAX', reason: string }
  //
  //   POST /api/competitions/:id/competitors/:competitorId/clear-status
  //        body: {} (presence is the action)
  //
  // Both endpoints share the same cross-competition pre-flight, event-insert,
  // WS broadcast, and projection-dirty contract as the legacy manual-dnf /
  // un-dnf pair above. The legacy routes stay because Phase 1 fixtures and
  // older clients still post to them; both surfaces converge on the same
  // view.manual_status field in the reducer.
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/status',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const parsed = ManualStatusInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      // Idempotency: if the current projection already has the same manual_status
      // asserted, skip the event insertion and return 200 (not 201).
      const projection = app.projectionStore.recomputeNow(competitionId);
      const view = projection?.competitors.get(competitorId);
      if (view?.manual_status === parsed.data.status) {
        return reply.code(200).send({ idempotent: true });
      }

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'manual_status_set',
        Date.now(),
        {
          event_type: 'manual_status_set',
          competitor_id: competitorId,
          status: parsed.data.status,
          reason: parsed.data.reason,
        },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'manual_status_set',
        payload: {
          competitor_id: competitorId,
          status: parsed.data.status,
          reason: parsed.data.reason,
        },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );

  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/clear-status',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      // Idempotency: if manual_status is already null, return 200 without event.
      const projection = app.projectionStore.recomputeNow(competitionId);
      const view = projection?.competitors.get(competitorId);
      if (view !== undefined && view.manual_status === null) {
        return reply.code(200).send({ idempotent: true });
      }

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'clear_manual_status',
        Date.now(),
        { event_type: 'clear_manual_status', competitor_id: competitorId },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'clear_manual_status',
        payload: { competitor_id: competitorId },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 2.1 (D-16) — voided-leg routes.
  //
  //   POST /api/competitions/:id/competitors/:cid/void-leg
  //   POST /api/competitions/:id/competitors/:cid/unvoid-leg
  //
  // Both endpoints follow the same pattern as the manual-status routes:
  //   1. Cross-competition pre-flight (404 if competitor not in competition).
  //   2. Zod-validate body.
  //   3. Insert event via insertEvent.
  //   4. Broadcast on readout channel.
  //   5. markDirty for projection recompute.
  //
  // T-02.1-01 mitigation: control_code is validated as integer by Zod;
  // competitor ownership is verified by the cross-competition pre-flight.
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/void-leg',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const parsed = VoidLegInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'leg_voided',
        Date.now(),
        {
          event_type: 'leg_voided',
          competitor_id: competitorId,
          control_code: parsed.data.control_code,
          max_seconds: parsed.data.max_seconds,
          ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
        },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'leg_voided',
        payload: {
          competitor_id: competitorId,
          control_code: parsed.data.control_code,
          max_seconds: parsed.data.max_seconds,
        },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );

  app.post<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/unvoid-leg',
    async (req, reply) => {
      const { id: competitionId, competitorId } = req.params;
      const parsed = UnvoidLegInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const competitor = app.fartolaDb.db
        .select({ id: competitorsTable.id })
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitorId),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitor) return reply.code(404).send({ error: 'competitor_not_found' });

      const r = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'leg_unvoided',
        Date.now(),
        {
          event_type: 'leg_unvoided',
          competitor_id: competitorId,
          control_code: parsed.data.control_code,
        },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'leg_unvoided',
        payload: {
          competitor_id: competitorId,
          control_code: parsed.data.control_code,
        },
        seq: r.local_seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ local_seq: r.local_seq });
    }
  );
}
