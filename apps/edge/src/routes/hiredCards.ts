// Authored for fartola. Not ported from upstream.
//
// REST surface for the Plan 02-05 Hyrbricka (hired card) return UX:
//
//   - GET   /api/competitions/:id/hired-cards
//   - PATCH /api/competitions/:id/hired-cards/:cardNumber/return
//
// Reuses the hired_cards table landed in Plan 02-01 (compound PK
// [competition_id, card_number] per D-HB-1). Plan 02-02 already writes
// hired_cards rows from the walk-up POST; this plan adds the read +
// return surface.
//
// GET semantics — partitioned by returned_at_ms:
//   - open[]:     returned_at_ms IS NULL, ORDER BY marked_at_ms DESC.
//   - returned[]: returned_at_ms IS NOT NULL, ORDER BY marked_at_ms DESC.
// The ReadoutView toast reads /readout (single source of truth); this
// surface backs the admin "Aktiva hyrbrickor" view + future
// reconciliation reports.
//
// PATCH semantics:
//   - Pre-flight SELECT scoped to (competition_id, card_number). Missing
//     row → 404 not_found. Composite PK isolation: a card belonging to a
//     different competition is also a 404.
//   - Row exists AND returned_at_ms already set → 200 with
//     `already_returned: true` AND the original timestamp preserved
//     (idempotent — a second tap from the operator should be harmless).
//     No WS broadcast in this branch.
//   - Row exists AND returned_at_ms NULL → sqlite.transaction UPDATEs
//     returned_at_ms = now; AFTER commit broadcast
//     `hired_card_returned` envelope on readoutChannel(competition_id)
//     (PATTERNS S-4). Return 200 with the new timestamp.
//
// Was the D-MIP-1 / D-MOP-4 "no auth, closed club LAN" posture. Those were
// revised on 2026-10-05 (MeOS password, integrations/meos/access.ts); the
// PATCH here goes through the server.ts event-code write gate like every
// competition write.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 1
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-1 (junction PK)
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-2 (Returnerad button)
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §S-4 (broadcast-after-commit)
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §S-5 (pre-flight before tx)

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNotNull, isNull, sum } from 'drizzle-orm';
import { z } from 'zod';

import { competitors, hiredCards } from '../db/schema.ts';
import { readoutChannel } from '@fartola/shared-types';
import { issuesToErrors } from './_zod-errors.ts';

const ListParams = z.object({
  id: z.string().min(1),
});

const PatchParams = z.object({
  id: z.string().min(1),
  cardNumber: z.coerce.number().int().positive(),
});

interface HiredCardRow {
  competition_id: string;
  card_number: number;
  marked_at_ms: number;
  returned_at_ms: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  note: string | null;
  /** SOFT TR 4.12.4 — rental fee in kronor; null = none. */
  fee: number | null;
}

function rowToDTO(r: {
  competitionId: string;
  cardNumber: number;
  markedAtMs: number;
  returnedAtMs: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  note: string | null;
  fee: number | null;
}): HiredCardRow {
  return {
    competition_id: r.competitionId,
    card_number: r.cardNumber,
    marked_at_ms: r.markedAtMs,
    returned_at_ms: r.returnedAtMs,
    contact_name: r.contactName,
    contact_phone: r.contactPhone,
    contact_email: r.contactEmail,
    note: r.note,
    fee: r.fee,
  };
}

export default async function registerHiredCardsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/competitions/:id/hired-cards
  app.get<{ Params: { id: string } }>('/api/competitions/:id/hired-cards', async (req, reply) => {
    const parsed = ListParams.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const { id } = parsed.data;

    // Two scoped SELECTs partitioned by returned_at_ms IS NULL. Cheaper
    // than one SELECT + an in-memory partition on a hot competition
    // (the row count is bounded by the rental fleet — tens of rows in
    // typical 4-klubbs scale).
    const openRows = app.fartolaDb.db
      .select()
      .from(hiredCards)
      .where(and(eq(hiredCards.competitionId, id), isNull(hiredCards.returnedAtMs)))
      .orderBy(desc(hiredCards.markedAtMs))
      .all();

    const returnedRows = app.fartolaDb.db
      .select()
      .from(hiredCards)
      .where(and(eq(hiredCards.competitionId, id), isNotNull(hiredCards.returnedAtMs)))
      .orderBy(desc(hiredCards.markedAtMs))
      .all();

    // What was paid at the desk today, per method (cash-up; the same
    // amounts the ResultList carries as PaidAmount).
    const paidRows = app.fartolaDb.db
      .select({ method: competitors.paidMethod, total: sum(competitors.paidAmount) })
      .from(competitors)
      .where(and(eq(competitors.competitionId, id), gt(competitors.paidAmount, 0)))
      .groupBy(competitors.paidMethod)
      .all();
    const paidBy = (m: string | null) => Number(paidRows.find((r) => r.method === m)?.total ?? 0);
    const cash = paidBy('cash');
    const swish = paidBy('swish');
    const other = paidBy(null);

    return {
      open: openRows.map(rowToDTO),
      returned: returnedRows.map(rowToDTO),
      paid_on_site: { cash, swish, other, total: cash + swish + other },
    };
  });

  // PATCH /api/competitions/:id/hired-cards/:cardNumber/return
  app.patch<{ Params: { id: string; cardNumber: string } }>(
    '/api/competitions/:id/hired-cards/:cardNumber/return',
    async (req, reply) => {
      const parsed = PatchParams.safeParse(req.params);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const { id, cardNumber } = parsed.data;

      // Pre-flight SELECT (PATTERNS S-5). Scoped to (competition_id,
      // card_number) — a card from another competition is a 404 by
      // composite-PK design.
      const row = app.fartolaDb.db
        .select()
        .from(hiredCards)
        .where(and(eq(hiredCards.competitionId, id), eq(hiredCards.cardNumber, cardNumber)))
        .get();

      if (!row) {
        return reply.code(404).send({ error: 'not_found' });
      }

      // Idempotent: already-returned cards return 200 with the original
      // timestamp; the operator's second tap is harmless. No broadcast
      // (the prior PATCH already emitted one — re-emitting confuses the
      // UI's Set-based dismissal logic).
      if (row.returnedAtMs !== null) {
        return reply.code(200).send({
          ok: true,
          already_returned: true,
          returned_at_ms: row.returnedAtMs,
        });
      }

      // Gemini review G-001 (race condition): two concurrent PATCH /return
      // requests for the same card can both pass the pre-flight SELECT
      // above (line 153), then both UPDATE, then both broadcast — leading
      // to duplicate hired_card_returned envelopes on the wire. Fix:
      //   (a) include isNull(returnedAtMs) in the UPDATE WHERE so only
      //       ONE of the racing writes flips the row,
      //   (b) capture the row-count from inside the transaction so the
      //       broadcast is gated on the actual UPDATE landing (the loser
      //       of the race sees changes=0 and stays silent).
      // Pattern lifted from entryImport.ts (PATTERNS S-2 transactional
      // capture-then-act).
      const now = Date.now();
      let changes = 0;
      app.fartolaDb.sqlite.transaction(() => {
        const result = app.fartolaDb.db
          .update(hiredCards)
          .set({ returnedAtMs: now })
          .where(
            and(
              eq(hiredCards.competitionId, id),
              eq(hiredCards.cardNumber, cardNumber),
              isNull(hiredCards.returnedAtMs)
            )
          )
          .run();
        changes = result.changes;
      })();

      if (changes > 0) {
        // PATTERNS S-4: broadcast AFTER commit so subscribers only see
        // committed state. ReadoutView reads this envelope informationally —
        // it has its own dismissal Set covering the operator's own click,
        // but the WS receipt covers the cross-operator case (another
        // operator returned the same card from the admin view).
        app.wsBroadcast(readoutChannel(id), {
          type: 'hired_card_returned',
          payload: {
            card_number: cardNumber,
            returned_at_ms: now,
          },
        });
      }

      return reply.code(200).send({ ok: true, returned_at_ms: now });
    }
  );
}
