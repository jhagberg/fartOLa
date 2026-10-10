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
  ClearManualStatusInput,
  VoidLegInput,
  UnvoidLegInput,
  ManualFinishInput,
  ManualPunchInput,
  RemoveManualPunchInput,
  ClearCorrectionInput,
  readoutChannel,
} from '@fartola/shared-types';
import type { ZodType } from 'zod';
import { competitors as competitorsTable, type EventPayload } from '../db/schema.ts';
import type { CompetitorView } from '../projection/types.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { issuesToErrors } from './_zod-errors.ts';

/** The reason "Sätt ej utlästa till Ej start" writes; undo clears only
 * DNS with this reason (SOFT TA till TR 7.8.2). */
export const UNREAD_DNS_REASON = 'Ej utläst: satt till Ej start';

type CorrectionPayload = Extract<
  EventPayload,
  {
    event_type:
      'manual_finish_set' | 'manual_finish_cleared' | 'manual_punch_added' | 'manual_punch_removed';
  }
>;

type ManualStatusPayload = Extract<
  EventPayload,
  { event_type: 'manual_status_set' | 'clear_manual_status' }
>;

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
  //        body: { status: 'DNF'|'DNS'|'DQ'|'CANCEL'|'MAX'|'MP', reason: string }
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
      // Reject unexpected body fields (02-11 LOW: was passthrough, now strict).
      const parsedBody = ClearManualStatusInput.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        return reply.code(400).send(issuesToErrors(parsedBody.error.issues));
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
  // A voided leg means "approve without this control" for one runner; the
  // running time is never reduced (SOFT TR 4.20.10, decided 2026-10-05), so
  // the body takes no time cap.
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
          ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
        },
        competitionId
      );
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'leg_voided',
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

  // ---------------------------------------------------------------------------
  // SOFT TA till TR 7.8.2 — "Sätt ej utlästa till Ej start".
  //
  //   POST /api/competitions/:id/unread-dns       → { count }
  //   POST /api/competitions/:id/unread-dns/undo  → { count }
  //
  // Unread is not "not started", so nothing infers DNS. The operator sets
  // every runner with no read-out and no status to DNS, as MeOS "Sätt okända
  // löpare utan registrering till <Ej Start>" (TabRunner.cpp:974-986). The
  // fixed reason marks these, so undo clears exactly them (still DNS with
  // that reason and still no read-out).
  // ---------------------------------------------------------------------------
  const bulk = (
    competitionId: string,
    pick: (v: CompetitorView) => boolean,
    payload: (competitorId: string) => ManualStatusPayload
  ): number | null => {
    const state = app.projectionStore.recomputeNow(competitionId);
    if (state === null) return null;
    const ids = [...state.competitors.values()].filter(pick).map((v) => v.id);
    const written = app.fartolaDb.sqlite.transaction(() =>
      ids.map((id) => {
        const p = payload(id);
        return {
          p,
          r: insertEvent(
            app.fartolaDb,
            app.fartolaNodeId,
            p.event_type,
            Date.now(),
            p,
            competitionId
          ),
        };
      })
    )();
    for (const { p, r } of written) {
      const { event_type: type, ...rest } = p;
      app.wsBroadcast(readoutChannel(competitionId), { type, payload: rest, seq: r.local_seq });
    }
    if (ids.length > 0) app.projectionStore.markDirty(competitionId);
    return ids.length;
  };

  app.post<{ Params: { id: string } }>('/api/competitions/:id/unread-dns', async (req, reply) => {
    const count = bulk(
      req.params.id,
      (v) => v.status === 'PEND' && v.manual_status === null && v.card_read_history.length === 0,
      (competitorId) => ({
        event_type: 'manual_status_set',
        competitor_id: competitorId,
        status: 'DNS',
        reason: UNREAD_DNS_REASON,
      })
    );
    if (count === null) return reply.code(404).send({ error: 'competition_not_found' });
    return reply.code(201).send({ count });
  });

  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/unread-dns/undo',
    async (req, reply) => {
      const count = bulk(
        req.params.id,
        (v) =>
          v.manual_status === 'DNS' &&
          v.manual_dnf_reason === UNREAD_DNS_REASON &&
          v.card_read_history.length === 0,
        (competitorId) => ({ event_type: 'clear_manual_status', competitor_id: competitorId })
      );
      if (count === null) return reply.code(404).send({ error: 'competition_not_found' });
      return reply.code(201).send({ count });
    }
  );

  // ---------------------------------------------------------------------------
  // Secretariat corrections. Each is one event with a reason, removed by a
  // compensating event; the projection folds them over the whole log, so a
  // later read-out does not overwrite one (projection/corrections.ts).
  //
  //   POST …/competitors/:cid/manual-finish        SOFT TR 4.20.6 — MeOS
  //   POST …/competitors/:cid/clear-manual-finish  "Måltid:" (TabRunner.cpp:3446)
  //   POST …/competitors/:cid/manual-punch         SOFT TR 8.1.4 (kommentar) — MeOS
  //   POST …/competitors/:cid/remove-manual-punch  "<< Lägg till stämpling" (:3571)
  // ---------------------------------------------------------------------------
  const correction = <T>(
    path: string,
    schema: ZodType<T>,
    payload: (competitorId: string, body: T) => CorrectionPayload
  ): void => {
    app.post<{ Params: { id: string; competitorId: string } }>(
      `/api/competitions/:id/competitors/:competitorId/${path}`,
      async (req, reply) => {
        const { id: competitionId, competitorId } = req.params;
        const parsed = schema.safeParse(req.body ?? {});
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

        const p = payload(competitorId, parsed.data);
        const r = insertEvent(
          app.fartolaDb,
          app.fartolaNodeId,
          p.event_type,
          Date.now(),
          p,
          competitionId
        );
        const { event_type: type, ...rest } = p;
        app.wsBroadcast(readoutChannel(competitionId), { type, payload: rest, seq: r.local_seq });
        app.projectionStore.markDirty(competitionId);
        return reply.code(201).send({ local_seq: r.local_seq });
      }
    );
  };

  correction('manual-finish', ManualFinishInput, (competitor_id, body) => ({
    event_type: 'manual_finish_set',
    competitor_id,
    finish_ms: body.finish_ms,
    reason: body.reason,
  }));
  correction('clear-manual-finish', ClearCorrectionInput, (competitor_id) => ({
    event_type: 'manual_finish_cleared',
    competitor_id,
  }));
  correction('manual-punch', ManualPunchInput, (competitor_id, body) => ({
    event_type: 'manual_punch_added',
    competitor_id,
    control_code: body.control_code,
    reason: body.reason,
  }));
  correction('remove-manual-punch', RemoveManualPunchInput, (competitor_id, body) => ({
    event_type: 'manual_punch_removed',
    competitor_id,
    control_code: body.control_code,
  }));
}
