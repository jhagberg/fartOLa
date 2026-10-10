// Authored for fartola. Not ported from upstream.
//
// REST routes for competitors — walk-up registration (D-04 first-class) +
// list/single read. POST /api/competitors is the path the SvelteKit walk-up
// modal (plan 14) consumes.
//
// Routes registered here:
//   - POST /api/competitors                              — walk-up create OR replace-card (atomic)
//   - GET  /api/competitions/:id/competitors             — list competitors for a competition
//   - GET  /api/competitions/:id/competitors/:competitorId  — single competitor (walk-up modal pre-fill)
//
// POST /api/competitors has TWO modes selected by the request body:
//
//   **Create mode (default — D-04 walk-up first-class):**
//     1. Zod safeParse(CompetitorCreateInput) → 400 with structured errors
//        if consent !== true OR any required field fails.
//     2. Verify competition_id exists → 404 if not.
//     3. Verify class_id exists AND belongs to competition_id → 422 if
//        semantically wrong (T-CLASS-COMP-MISMATCH).
//     4. If card_number provided, check the partial unique index — another
//        competitor in this competition holding the same card → 409 with
//        `{ error: 'card_taken', existing_competitor_id }`.
//     5. In a single sqlite.transaction:
//          - Insert competitor row with consent_at_ms = Date.now(), consent
//            status default 'explicit', scrubbed_at_ms = null.
//          - If club non-null + non-empty, upsert clubs row.
//          - If card_number provided, insert events row eventType='card_bound'.
//            local_seq via app.fartolaNextLocalSeq (PATTERNS S-2 injection).
//     6. After commit, if card_number provided, app.wsBroadcast on
//        readout:<competition_id> with type='card_bound' + payload.
//     7. Return 201 + CompetitorDTO.
//
//   **Replace-card mode (plan 10 — operator corrects misread Bricka):**
//     1. body.replace_card_for_competitor_id is set; Zod requires
//        card_number, everything else optional.
//     2. Verify the named competitor exists AND belongs to body.competition_id
//        → 404 if either check fails. Cross-competition reject is the
//        T-CROSS-COMP-REPLACE mitigation (mirrors T-CROSS-COMP-MANUAL).
//     3. Verify the new card_number is not already taken by a DIFFERENT
//        competitor in this competition → 409 'card_taken' (the partial
//        unique index would catch this at INSERT time, but a pre-flight
//        SELECT returns a structured response instead of a raw constraint
//        error). If the same competitor already holds this card_number,
//        the UPDATE is a no-op but the card_bound event is still emitted.
//     4. In a single sqlite.transaction:
//          - UPDATE competitors SET card_number=? WHERE id=?.
//          - Insert events row eventType='card_bound' + payload preserving
//            the original consent_at_ms (REQ-PRIV-001) and logging the
//            previous card (previous_card_number). local_seq via
//            app.fartolaNextLocalSeq.
//          - hired_card=true (same contact rule as create mode): open the
//            rental of the new card in hired_cards.
//     5. After commit, app.wsBroadcast on readout:<competition_id> with
//        type='card_bound' + payload AND projectionStore.markDirty so the
//        re-binding clears pending_unknown_cards on next recompute.
//     6. Return 200 + updated CompetitorDTO + `card_event` { node_id,
//        local_seq, previous_card_number } for POST .../card-binds/undo.
//
// REQ-PRIV-001: server attests consent_at_ms (Date.now()) in create mode;
// preserves the original row's consent_at_ms in replace mode (consent was
// already given at walk-up; only the card number is corrected). The Zod
// literal `true` on `consent` in create mode prevents T-CONSENT-BYPASS.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-10-PLAN.md task 2
//   (replace-card-for-competitor extension)
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-04 D-11
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Walk-up modal" (Bricka editable to correct misread)

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  CompetitorCreateInput,
  type CompetitorDTO,
  entryFeeFor,
  isYouthByBirthYear,
  localToEpochMs,
  paysYouthFee,
  readoutChannel,
} from '@fartola/shared-types';
import { classes, clubs, competitions, competitors, events, hiredCards } from '../db/schema.ts';
import { UnknownCompetitor, writeStartTimes } from '../db/startTimes.ts';
import type { Competitor } from '../db/types.ts';
import { issuesToErrors } from './_zod-errors.ts';

// C-M4 — PATCH /api/competitors/:id consent-confirmation body schema.
// Only the pending_first_read → confirmed_on_read transition is allowed;
// the route returns 422 on any other source state (mitigates
// T-CONSENT-FORCED-FLIP in plan 14's threat register).
const PatchConsentSchema = z.object({
  consent_status: z.literal('confirmed_on_read'),
  consent_at_ms: z.number().int().positive(),
});

// PATCH /api/competitors/:id/profile body schema (this session, not a plan).
// Operator-driven edits to an existing competitor row — name, club, class
// assignment, card number or bib (SOFT TR 7.5.4; '' or null clears it). Each
// field is optional; an empty body is a 200 no-op. Card-number changes emit a card_bound event so the projection
// can re-match pending reads to the corrected card.
const PatchProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    club: z.string().trim().max(120).nullable().optional(),
    class_id: z.string().uuid().optional(),
    card_number: z.number().int().positive().nullable().optional(),
    bib: z.string().trim().max(16).nullable().optional(),
    paid_amount: z.number().int().min(0).max(100000).optional(),
    paid_method: z.enum(['cash', 'swish']).nullable().optional(),
  })
  .strict();

// PATCH /api/competitions/:id/competitors/:competitorId/start-time body
// (02.1-14): one runner's drawn start as epoch ms, or null to clear it. The
// > 1e12 floor rejects the old local ms-since-midnight base. Shared with
// the missing-starts batch (Task 15, routes/missingStarts.ts).
export const StartTimeMs = z.number().int().gt(1e12).nullable();
const PatchStartTimeSchema = z.object({ start_time_ms: StartTimeMs }).strict();

/** True when err is a SQLite UNIQUE-constraint violation on
 * competitors.card_number — i.e. the D-11 partial unique index
 * `competitors_card_per_comp` rejected the write. better-sqlite3 sets
 * `.code = 'SQLITE_CONSTRAINT_UNIQUE'` and the message includes the
 * column path.
 *
 * Defense in depth for the card_taken race (PR #3 review — Gemini
 * medium): the pre-flight SELECT is non-transactional, so two
 * concurrent walk-ups / card replacements could both pass the
 * collision check before either commits. The partial unique index
 * still rejects the second write at the SQL layer; this helper lets
 * the handler convert that into the same structured 409 the pre-flight
 * path returns, instead of leaking a 500 with a raw SQLite error. */
function isCardCollisionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE') return false;
  return err.message.includes('competitors.card_number');
}

function paidEcho(app: FastifyInstance, id: string) {
  const r = app.fartolaDb.db
    .select({ a: competitors.paidAmount, m: competitors.paidMethod })
    .from(competitors)
    .where(eq(competitors.id, id))
    .get();
  return { paid_amount: r?.a ?? 0, paid_method: (r?.m ?? null) as 'cash' | 'swish' | null };
}

/** Record the whole charge (fee, surcharge, card rental) as paid at the
 * desk, from the competitor's own fee figures; run after the rental is
 * upserted so the card fee is in. */
function recordPaid(app: FastifyInstance, id: string, method: 'cash' | 'swish'): void {
  const c = app.fartolaDb.db
    .select({ e: competitors.entryFee, l: competitors.lateFee, c: competitors.cardFee })
    .from(competitors)
    .where(eq(competitors.id, id))
    .get();
  app.fartolaDb.db
    .update(competitors)
    .set({ paidAmount: (c?.e ?? 0) + (c?.l ?? 0) + (c?.c ?? 0), paidMethod: method })
    .where(eq(competitors.id, id))
    .run();
}

function competitorRowToDTO(row: Competitor): CompetitorDTO {
  return {
    id: row.id,
    competition_id: row.competitionId,
    name: row.name,
    club: row.club,
    class_id: row.classId,
    card_number: row.cardNumber,
    consent_at_ms: row.consentAtMs,
    consent_status: row.consentStatus,
    scrubbed_at_ms: row.scrubbedAtMs,
    start_time_ms: row.startTimeMs ?? null,
    bib: row.bib,
    paid_amount: row.paidAmount,
    paid_method: row.paidMethod as 'cash' | 'swish' | null,
  };
}

/** D-HB-3: a hired card needs a phone number or an e-mail address. */
function hiredContactMissing(input: CompetitorCreateInput): boolean {
  if (input.hired_card !== true) return false;
  const hc = input.hired_contact;
  return (hc?.phone?.trim() ?? '') === '' && (hc?.email?.trim() ?? '') === '';
}

/** Open (or reopen) the rental of `cardNumber` for `competitorId`. Run
 * inside the write's transaction so a failure leaves no orphan rental. The
 * compound PK [competitionId, cardNumber] upserts (Pitfall 10): re-renting a
 * card resets marked_at_ms and clears returned_at_ms. The rental fee is the
 * competition's card fee at that moment (SOFT TR 4.12.4: only a hired card
 * is charged), recorded on the rental and on the renter, so a later card
 * change keeps the charge with the runner who rented. */
function upsertHiredCard(
  app: FastifyInstance,
  input: CompetitorCreateInput,
  competitorId: string,
  cardNumber: number,
  now: number
): void {
  const hc = input.hired_contact ?? null;
  const orNull = (v: string | null | undefined): string | null =>
    v && v.trim() !== '' ? v.trim() : null;
  const contact = {
    contactName: orNull(hc?.name),
    contactPhone: orNull(hc?.phone),
    contactEmail: orNull(hc?.email),
    note: orNull(hc?.note),
  };
  const fee =
    app.fartolaDb.db
      .select({ cardFee: competitions.cardFee })
      .from(competitions)
      .where(eq(competitions.id, input.competition_id))
      .get()?.cardFee ?? null;
  app.fartolaDb.db
    .insert(hiredCards)
    .values({
      competitionId: input.competition_id,
      cardNumber,
      markedAtMs: now,
      returnedAtMs: null,
      ...contact,
      fee,
    })
    .onConflictDoUpdate({
      target: [hiredCards.competitionId, hiredCards.cardNumber],
      set: { markedAtMs: now, returnedAtMs: null, ...contact, fee },
    })
    .run();
  app.fartolaDb.db
    .update(competitors)
    .set({ cardFee: fee })
    .where(eq(competitors.id, competitorId))
    .run();
}

export default async function registerCompetitors(app: FastifyInstance): Promise<void> {
  // POST /api/competitors — walk-up registration (D-04 first-class) OR
  // replace-card-for-competitor (plan 10 misread correction).
  app.post('/api/competitors', async (req, reply) => {
    const parsed = CompetitorCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const input = parsed.data;

    // (2) Competition must exist (both modes).
    const compRow = app.fartolaDb.db
      .select({ id: competitions.id, date: competitions.date })
      .from(competitions)
      .where(eq(competitions.id, input.competition_id))
      .get();
    if (!compRow) return reply.code(404).send({ error: 'competition not found' });

    // -------------------------------------------------------------------
    // Replace-card mode — operator corrects a misread Bricka. Zod has
    // already enforced that card_number is non-null here.
    // -------------------------------------------------------------------
    if (input.replace_card_for_competitor_id !== undefined) {
      // (3r) Locate the target competitor scoped to this competition.
      // Cross-competition reject (T-CROSS-COMP-REPLACE) — 404 even when
      // the id exists in some other competition.
      const target = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(
          and(
            eq(competitors.id, input.replace_card_for_competitor_id),
            eq(competitors.competitionId, input.competition_id)
          )
        )
        .get();
      if (!target) return reply.code(404).send({ error: 'competitor_not_found' });

      // input.card_number is guaranteed non-null by Zod superRefine. TS
      // narrows on the explicit check.
      const newCardNumber = input.card_number;
      if (newCardNumber === null) {
        // Belt-and-braces — Zod superRefine should have caught this.
        return reply.code(400).send({
          errors: [
            { path: 'card_number', code: 'custom', message: 'card_number required for replace' },
          ],
        });
      }

      if (hiredContactMissing(input)) {
        return reply.code(400).send({ error: 'hyrbricka_contact_required' });
      }

      // (4r) Collision check — another competitor in this competition
      // already holds the new card. The partial unique index would
      // throw at UPDATE time but the pre-flight SELECT returns a
      // structured 409 (mirrors create-mode behavior).
      if (newCardNumber !== target.cardNumber) {
        const collision = app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(
            and(
              eq(competitors.competitionId, input.competition_id),
              eq(competitors.cardNumber, newCardNumber)
            )
          )
          .get();
        if (collision && collision.id !== target.id) {
          return reply
            .code(409)
            .send({ error: 'card_taken', existing_competitor_id: collision.id });
        }
      }

      // (5r) Atomic UPDATE + card_bound event. consent_at_ms preserved.
      const now = Date.now();
      let seq: number | null = null;
      try {
        app.fartolaDb.sqlite.transaction(() => {
          app.fartolaDb.db
            .update(competitors)
            .set({ cardNumber: newCardNumber })
            .where(eq(competitors.id, target.id))
            .run();

          // PATTERNS S-2 injection — same path as create mode so test 9
          // covers both branches.
          seq = app.fartolaNextLocalSeq(app.fartolaDb, app.fartolaNodeId);
          app.fartolaDb.db
            .insert(events)
            .values({
              nodeId: app.fartolaNodeId,
              localSeq: seq,
              competitionId: input.competition_id,
              eventType: 'card_bound',
              eventTimeMs: now,
              recordedAtMs: now,
              payload: {
                event_type: 'card_bound',
                competitor_id: target.id,
                card_number: newCardNumber,
                walkup: true,
                // REQ-PRIV-001: preserve the original consent timestamp.
                // Fallback to `now` only if the row pre-existed without a
                // consent_at_ms (legacy data from plan 05 EntryList import).
                consent_at_ms: target.consentAtMs ?? now,
                // Logged so the replacement can be undone.
                previous_card_number: target.cardNumber,
              },
            })
            .run();
          if (input.hired_card === true) upsertHiredCard(app, input, target.id, newCardNumber, now);
          if (input.paid_method !== undefined) recordPaid(app, target.id, input.paid_method);
        })();
      } catch (err) {
        // The pre-flight SELECT above is non-transactional, so a concurrent
        // request can land the same card_number between our check and
        // commit. The partial unique index still rejects the second write
        // — convert that into the same structured 409 the pre-flight
        // returns. Look up the colliding row again so the response carries
        // a useful existing_competitor_id.
        if (isCardCollisionError(err)) {
          const collision = app.fartolaDb.db
            .select({ id: competitors.id })
            .from(competitors)
            .where(
              and(
                eq(competitors.competitionId, input.competition_id),
                eq(competitors.cardNumber, newCardNumber)
              )
            )
            .get();
          return reply.code(409).send({
            error: 'card_taken',
            existing_competitor_id: collision?.id ?? null,
          });
        }
        throw err;
      }

      if (seq !== null) {
        app.wsBroadcast(readoutChannel(input.competition_id), {
          type: 'card_bound',
          payload: {
            competitor_id: target.id,
            card_number: newCardNumber,
            competition_id: input.competition_id,
            class_id: target.classId,
            name: target.name,
            club: target.club,
          },
          seq,
        });
        app.projectionStore.markDirty(input.competition_id);
      }

      const dto: CompetitorDTO = {
        id: target.id,
        competition_id: input.competition_id,
        name: target.name,
        club: target.club,
        class_id: target.classId,
        card_number: newCardNumber,
        consent_at_ms: target.consentAtMs,
        consent_status: target.consentStatus,
        scrubbed_at_ms: target.scrubbedAtMs,
        start_time_ms: target.startTimeMs ?? null,
        bib: target.bib,
        ...paidEcho(app, target.id),
      };
      // card_event: the logged change, for POST .../card-binds/undo.
      return reply.code(200).send({
        ...dto,
        card_event: {
          node_id: app.fartolaNodeId,
          local_seq: seq,
          previous_card_number: target.cardNumber,
        },
      });
    }

    // -------------------------------------------------------------------
    // Create mode — D-04 walk-up first-class.
    //
    // Zod superRefine has already enforced name + class_id + consent
    // presence in this branch, so the narrowing below is safe. TS
    // cannot infer the narrowing across superRefine; the explicit
    // checks are belt-and-braces against a misconfigured schema.
    // -------------------------------------------------------------------
    if (input.name === undefined || input.class_id === undefined) {
      // Unreachable in practice — superRefine ran above.
      return reply.code(400).send({
        errors: [
          {
            path: input.name === undefined ? 'name' : 'class_id',
            code: 'custom',
            message: 'required',
          },
        ],
      });
    }
    const createName = input.name;
    const createClassId = input.class_id;

    // (3) Class must exist AND belong to the competition.
    const classRow = app.fartolaDb.db
      .select({
        id: classes.id,
        competitionId: classes.competitionId,
        classKind: classes.classKind,
        entryFee: classes.entryFee,
        youthEntryFee: classes.youthEntryFee,
        lateFeePct: classes.lateFeePct,
        eventorEntryFeeId: classes.eventorEntryFeeId,
        eventorYouthFeeId: classes.eventorYouthFeeId,
        eventorLateFeeId: classes.eventorLateFeeId,
      })
      .from(classes)
      .where(eq(classes.id, createClassId))
      .get();
    if (!classRow) return reply.code(422).send({ error: 'class not found' });
    if (classRow.competitionId !== input.competition_id) {
      return reply.code(422).send({ error: 'class does not belong to competition' });
    }

    // (3.5) Phase 2.0 D-HB-3 — hired_card pre-flight (PATTERNS S-5: run
    // BEFORE opening the transaction so a missing-contact rejection
    // leaves zero side effects). If hired_card=true the operator MUST
    // supply at least phone OR email; the rental is the lever for
    // chasing down non-returners.
    if (hiredContactMissing(input)) {
      return reply.code(400).send({ error: 'hyrbricka_contact_required' });
    }

    // (4) Card-taken check — D-11 partial unique index covers this at the
    // SQL layer but a pre-flight SELECT gives the operator a structured
    // 409 response (with the colliding competitor id) instead of a raw
    // SQLITE_CONSTRAINT_UNIQUE error.
    if (input.card_number !== null) {
      const collision = app.fartolaDb.db
        .select({ id: competitors.id })
        .from(competitors)
        .where(
          and(
            eq(competitors.competitionId, input.competition_id),
            eq(competitors.cardNumber, input.card_number)
          )
        )
        .get();
      if (collision) {
        return reply.code(409).send({ error: 'card_taken', existing_competitor_id: collision.id });
      }
    }

    // (4.5) SOFT TR 4.12.6 — the fee this runner is told to pay: the class
    // fee and the surcharge, capped per class type. Before the competition
    // day it is a late entry, on the day a walk-up. No class fee set → no
    // fee recorded.
    // The Eventor fee ids behind the charge are fixed with it.
    const now = Date.now();
    const youthRunner =
      input.birth_year != null && isYouthByBirthYear(input.birth_year, compRow.date);
    const fee =
      classRow.entryFee === null
        ? null
        : entryFeeFor(
            classRow,
            youthRunner,
            now < localToEpochMs(compRow.date, 0) ? 'late' : 'walkup'
          );
    const youthFee =
      paysYouthFee(classRow.classKind, youthRunner) && classRow.youthEntryFee !== null;
    const feeIds =
      fee === null
        ? { eventorEntryFeeId: null, eventorLateFeeId: null }
        : {
            eventorEntryFeeId: youthFee ? classRow.eventorYouthFeeId : classRow.eventorEntryFeeId,
            eventorLateFeeId: fee.late > 0 ? classRow.eventorLateFeeId : null,
          };

    // (5) Atomic insert: competitor + (clubs upsert) + (card_bound event).
    const competitorId = crypto.randomUUID();
    let seq: number | null = null;

    try {
      app.fartolaDb.sqlite.transaction(() => {
        app.fartolaDb.db
          .insert(competitors)
          .values({
            id: competitorId,
            competitionId: input.competition_id,
            name: createName,
            club: input.club,
            classId: createClassId,
            cardNumber: input.card_number,
            consentAtMs: now,
            consentStatus: 'explicit',
            scrubbedAtMs: null,
            entryFee: fee?.entry ?? null,
            lateFee: fee?.late ?? null,
            birthYear: input.birth_year ?? null,
            ...feeIds,
          })
          .run();

        if (input.club !== null && input.club.length > 0) {
          // ON CONFLICT (name) DO UPDATE last_seen_at_ms = excluded.last_seen_at_ms.
          // Drizzle exposes onConflictDoUpdate on the sqlite insert builder.
          app.fartolaDb.db
            .insert(clubs)
            .values({ name: input.club, lastSeenAtMs: now })
            .onConflictDoUpdate({
              target: clubs.name,
              set: { lastSeenAtMs: now },
            })
            .run();
        }

        if (input.card_number !== null) {
          // PATTERNS S-2 injection: app.fartolaNextLocalSeq defaults to the
          // real nextLocalSeq trailing-edge SELECT; test 9 swaps in a
          // throwing fn to verify transactional atomicity.
          seq = app.fartolaNextLocalSeq(app.fartolaDb, app.fartolaNodeId);
          app.fartolaDb.db
            .insert(events)
            .values({
              nodeId: app.fartolaNodeId,
              localSeq: seq,
              competitionId: input.competition_id,
              eventType: 'card_bound',
              eventTimeMs: now,
              recordedAtMs: now,
              payload: {
                event_type: 'card_bound',
                competitor_id: competitorId,
                card_number: input.card_number,
                walkup: true,
                consent_at_ms: now,
              },
            })
            .run();
        }

        // Phase 2.0 D-HB-1 / Plan 02-02 task 2 — write the hired_cards row
        // inside the SAME transaction so a failure anywhere above rolls
        // back the rental too (no orphan rentals).
        if (input.hired_card === true && input.card_number !== null) {
          upsertHiredCard(app, input, competitorId, input.card_number, now);
        }

        // Paid at the desk: the whole charge is recorded as paid.
        if (input.paid_method !== undefined) recordPaid(app, competitorId, input.paid_method);
      })();
    } catch (err) {
      // Race-safety net (PR #3 review — Gemini medium). See the
      // matching catch in replace-mode above. The pre-flight SELECT is
      // non-transactional; the partial unique index catches concurrent
      // collisions at commit time. Look up the winner and surface the
      // same structured 409.
      if (isCardCollisionError(err) && input.card_number !== null) {
        const collision = app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(
            and(
              eq(competitors.competitionId, input.competition_id),
              eq(competitors.cardNumber, input.card_number)
            )
          )
          .get();
        return reply.code(409).send({
          error: 'card_taken',
          existing_competitor_id: collision?.id ?? null,
        });
      }
      throw err;
    }

    // (6) Broadcast AFTER commit so subscribers only see committed state.
    if (input.card_number !== null && seq !== null) {
      app.wsBroadcast(readoutChannel(input.competition_id), {
        type: 'card_bound',
        payload: {
          competitor_id: competitorId,
          card_number: input.card_number,
          competition_id: input.competition_id,
          class_id: createClassId,
          name: createName,
          club: input.club,
        },
        seq,
      });
      // Plan 08: walk-up bind ALSO touches the projection (clears
      // pending_unknown_cards once the projection sees this card_bound
      // event AND the competitor is now matchable against subsequent
      // card_read events). markDirty schedules a recompute + per-class
      // results_update broadcast.
      app.projectionStore.markDirty(input.competition_id);
    }

    // Echo the created row.
    const dto: CompetitorDTO = {
      id: competitorId,
      competition_id: input.competition_id,
      name: createName,
      club: input.club,
      class_id: createClassId,
      card_number: input.card_number,
      consent_at_ms: now,
      consent_status: 'explicit',
      scrubbed_at_ms: null,
      start_time_ms: null,
      bib: null,
      ...paidEcho(app, competitorId),
    };
    return reply.code(201).send(dto);
  });

  // PATCH /api/competitors/:id — C-M4 consent confirmation. Plan 14.
  //
  // Flip a single competitor's consent_status from 'pending_first_read'
  // (the default for EntryList-imported rows) to 'confirmed_on_read' and
  // stamp consent_at_ms. Emits a `consent_confirmed` events row inside the
  // same transaction so plan 17's daily scrub + plan 16's IOF export have
  // an audit trail. Any non-pending source state returns 422
  // (T-CONSENT-FORCED-FLIP mitigation).
  app.patch<{ Params: { id: string } }>('/api/competitors/:id', async (req, reply) => {
    const { id } = req.params;
    const parsed = PatchConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }

    const row = app.fartolaDb.db.select().from(competitors).where(eq(competitors.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'competitor_not_found' });

    if (row.consentStatus !== 'pending_first_read') {
      return reply.code(422).send({ error: 'consent_not_pending', current: row.consentStatus });
    }

    let seq: number | null = null;
    app.fartolaDb.sqlite.transaction(() => {
      app.fartolaDb.db
        .update(competitors)
        .set({ consentStatus: 'confirmed_on_read', consentAtMs: parsed.data.consent_at_ms })
        .where(eq(competitors.id, id))
        .run();

      seq = app.fartolaNextLocalSeq(app.fartolaDb, app.fartolaNodeId);
      app.fartolaDb.db
        .insert(events)
        .values({
          nodeId: app.fartolaNodeId,
          localSeq: seq,
          competitionId: row.competitionId,
          eventType: 'consent_confirmed',
          eventTimeMs: parsed.data.consent_at_ms,
          recordedAtMs: Date.now(),
          payload: {
            event_type: 'consent_confirmed',
            competitor_id: id,
            prior_consent_status: 'pending_first_read',
          },
        })
        .run();
    })();

    // markDirty so any subscribed results clients refresh — the projection
    // doesn't act on consent_confirmed (consent is row-state, not derived),
    // but flushing keeps the seq cursor in lockstep.
    app.projectionStore.markDirty(row.competitionId);

    return reply.code(200).send({ ok: true, competitor_id: id });
  });

  // PATCH /api/competitors/:id/profile — operator-driven edits to an existing
  // competitor (name, club, class_id, card_number). Distinct path from the
  // consent PATCH above so the C-M4 422 gate stays unambiguous. Validates
  // (a) competitor exists, (b) any class_id belongs to the same competition,
  // (c) any new card_number isn't already taken by a different competitor in
  // the same competition. Card-number changes emit a card_bound event for
  // projection consistency.
  app.patch<{ Params: { id: string } }>('/api/competitors/:id/profile', async (req, reply) => {
    const { id } = req.params;
    const parsed = PatchProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }

    const row = app.fartolaDb.db.select().from(competitors).where(eq(competitors.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'competitor_not_found' });

    const update: Omit<Partial<Competitor>, 'startTimeMs'> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.club !== undefined) update.club = parsed.data.club;
    if (parsed.data.class_id !== undefined) {
      const classRow = app.fartolaDb.db
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(eq(classes.id, parsed.data.class_id), eq(classes.competitionId, row.competitionId))
        )
        .get();
      if (!classRow) {
        return reply.code(422).send({ error: 'class_not_in_competition' });
      }
      update.classId = parsed.data.class_id;
      // A seeding group belongs to the class it was set in (SOFT TR 7.4.5).
      if (parsed.data.class_id !== row.classId) update.seedGroup = null;
    }
    const cardChanged =
      parsed.data.card_number !== undefined && parsed.data.card_number !== row.cardNumber;
    if (cardChanged) {
      const candidate = parsed.data.card_number ?? null;
      if (candidate !== null) {
        const clash = app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(
            and(
              eq(competitors.competitionId, row.competitionId),
              eq(competitors.cardNumber, candidate)
            )
          )
          .get();
        if (clash && clash.id !== id) {
          return reply.code(409).send({ error: 'card_already_bound' });
        }
      }
      update.cardNumber = candidate;
    }
    if (parsed.data.bib !== undefined) {
      const bib = parsed.data.bib === '' ? null : parsed.data.bib;
      if (bib !== null && bib !== row.bib) {
        const clash = app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(and(eq(competitors.competitionId, row.competitionId), eq(competitors.bib, bib)))
          .get();
        if (clash) return reply.code(409).send({ error: 'bib_taken', bib });
      }
      update.bib = bib;
    }
    if (parsed.data.paid_amount !== undefined) {
      update.paidAmount = parsed.data.paid_amount;
      // 0 = nothing paid, so no method either.
      if (parsed.data.paid_amount === 0) update.paidMethod = null;
    }
    if (parsed.data.paid_method !== undefined && parsed.data.paid_amount !== 0)
      update.paidMethod = parsed.data.paid_method;

    if (Object.keys(update).length === 0) {
      return reply.code(200).send({ ok: true, competitor: competitorRowToDTO(row) });
    }

    const now = Date.now();
    const newCard = parsed.data.card_number;
    app.fartolaDb.sqlite.transaction(() => {
      app.fartolaDb.db.update(competitors).set(update).where(eq(competitors.id, id)).run();
      if (cardChanged && typeof newCard === 'number') {
        const seq = app.fartolaNextLocalSeq(app.fartolaDb, app.fartolaNodeId);
        app.fartolaDb.db
          .insert(events)
          .values({
            nodeId: app.fartolaNodeId,
            localSeq: seq,
            competitionId: row.competitionId,
            eventType: 'card_bound',
            eventTimeMs: now,
            recordedAtMs: now,
            payload: {
              event_type: 'card_bound',
              competitor_id: id,
              card_number: newCard,
              walkup: false,
              consent_at_ms: row.consentAtMs ?? now,
            },
          })
          .run();
      }
    })();

    app.projectionStore.markDirty(row.competitionId);

    const updated = app.fartolaDb.db.select().from(competitors).where(eq(competitors.id, id)).get();
    if (!updated) return reply.code(404).send({ error: 'competitor_not_found' });
    return reply.code(200).send({ ok: true, competitor: competitorRowToDTO(updated) });
  });

  // GET /api/competitions/:id/competitors — list competitors. Optional
  // `?card_number=N` filter (used by /registration to detect re-beep of
  // an already-bound card before opening the walk-up form).
  app.get<{ Params: { id: string }; Querystring: { card_number?: string } }>(
    '/api/competitions/:id/competitors',
    async (req, reply) => {
      const { id } = req.params;
      const compRow = app.fartolaDb.db
        .select({ id: competitions.id })
        .from(competitions)
        .where(eq(competitions.id, id))
        .get();
      if (!compRow) return reply.code(404).send({ error: 'competition not found' });

      const cardFilter = req.query.card_number;
      if (cardFilter !== undefined) {
        const n = Number(cardFilter);
        if (!Number.isInteger(n) || n <= 0) {
          return { competitors: [] };
        }
        const rows = app.fartolaDb.db
          .select()
          .from(competitors)
          .where(and(eq(competitors.competitionId, id), eq(competitors.cardNumber, n)))
          .all();
        return { competitors: rows.map(competitorRowToDTO) };
      }

      const rows = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, id))
        .orderBy(asc(competitors.name))
        .all();
      return { competitors: rows.map(competitorRowToDTO) };
    }
  );

  // PATCH /api/competitions/:id/competitors/:competitorId/start-time — set or
  // clear one runner's drawn start (LottningView's per-runner edit). The
  // operator write gate in server.ts covers this path.
  app.patch<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId/start-time',
    async (req, reply) => {
      const { id, competitorId } = req.params;
      const parsed = PatchStartTimeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      try {
        writeStartTimes(app.fartolaDb, app.fartolaNodeId, id, {
          cause: 'manual',
          classId: null,
          changes: [{ competitorId, startTimeMs: parsed.data.start_time_ms }],
        });
      } catch (err) {
        if (err instanceof UnknownCompetitor)
          return reply.code(404).send({ error: 'competitor_not_found' });
        throw err;
      }
      app.projectionStore.markDirty(id);
      const row = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, competitorId))
        .get()!;
      return competitorRowToDTO(row);
    }
  );

  // GET /api/competitions/:id/competitors/:competitorId — single competitor.
  app.get<{ Params: { id: string; competitorId: string } }>(
    '/api/competitions/:id/competitors/:competitorId',
    async (req, reply) => {
      const { id, competitorId } = req.params;
      const row = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(and(eq(competitors.competitionId, id), eq(competitors.id, competitorId)))
        .get();
      if (!row) return reply.code(404).send({ error: 'competitor not found' });
      return competitorRowToDTO(row);
    }
  );
}
