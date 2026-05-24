// Authored for fartola. Not ported from upstream.
//
// REST handler: `GET /api/competitions/:id/readout`. Returns the live
// readout-view state in a single envelope so plan 13's SvelteKit
// /competition/[id]/readout page can paint on mount without waiting for
// the WS hello round-trip:
//
//   {
//     competition_id,
//     active,                  // true iff config.active_competition_id === id
//     current_read,            // last card_read row (any class) or null
//     history,                 // last 12 card_read events, newest first
//     pending_unknown_cards,   // from the projection store
//   }
//
// Each history row carries the per-event status (OK / MP / DNF / PEND)
// derived from the competitor's current projected view AND an
// `unmatched: boolean` flag for cards that didn't bind to any competitor.
// The status reflects the competitor's CURRENT state — re-reads update
// the OK/MP gate via reduce(), so an old card_read that was OK at the
// time but later overridden by manual_dnf shows status=DNF here. This
// matches UI-SPEC §"Readout view live behavior" (the history row label
// reflects the same data the live status pills do).
//
// `pending_unknown_cards` comes straight from the projection cache so
// plan 13's walk-up modal trigger reads the same source as the WS
// `results:` channel.
//
// Plan 13 + plan 14 contract: the SPA mounts → hits this endpoint for
// first paint → subscribes to WS readout:<id> for incremental updates.
// REST is the snapshot; WS is the delta.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-09-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Readout view live behavior" (history cap 12; current_read = most
//   recent card_read; pending_unknown_cards drives walk-up modal)
// - REQ-EVT-CMP-004 (walk-up registration)
// - REQ-EVT-CMP-005 (auto-attach card → competitor)

import type { FastifyInstance } from 'fastify';
import { eq, and, desc, isNull } from 'drizzle-orm';

import {
  events,
  competitors as competitorsTable,
  config,
  hiredCards,
  courses,
  courseControls,
  controls,
} from '../db/schema.ts';
import type { PunchStatus } from '../projection/types.ts';
import type { EventPayload } from '../db/schema.ts';

const ACTIVE_COMP_KEY = 'active_competition_id';

interface HistoryRow {
  event_time_ms: number;
  local_seq: number;
  card_number: number;
  card_type: string;
  competitor_id: string | null;
  competitor_name: string | null;
  status: PunchStatus;
  unmatched: boolean;
  /** Raw card punches in card order. Codes match station numbers; the
   * UI computes splits client-side from seconds_in_half_day. */
  punches: Array<{ code: number; seconds_in_half_day: number; half_day: number }>;
  /** Finish timestamp on the card, or null if the card never reached
   * the finish station. Used by the UI to compute elapsed time. */
  finish_seconds_in_half_day: number | null;
  finish_half_day: number | null;
  /** Start timestamp on the card, or null. */
  start_seconds_in_half_day: number | null;
  start_half_day: number | null;
  /** Suggested name extracted from the SI card's firmware-side
   * card_holder field (the owner programs this via SPORTident Config+).
   * Populated only when the card did NOT match a registered competitor
   * (unmatched=true). Lets the walk-up modal pre-fill the name field.
   * Most rental / club fleet cards have card_holder=null; personal cards
   * often have it set. Never persisted to competitors.name — the
   * operator confirms or edits the suggestion before binding. */
  card_holder_hint: string | null;
  /** Phase 2.0 Plan 02-05 — non-null when the card_number for this row
   * has an open hired_cards entry (returned_at_ms IS NULL) in this
   * competition. Drives the Hyrbricka finish-readout toast on the web
   * client. Explicit null (not absent) so the SPA can branch on
   * `hired_card_open !== null` without `in` checks. Single source of
   * truth — no per-card extra fetch (RESEARCH §"Pattern 6"). */
  hired_card_open: {
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    note: string | null;
  } | null;
  /** Phase 2.1 — course comparison breakdown for matched cards. The
   * reducer already computes these per CompetitorView; the readout
   * route surfaces them so the UI can show *which* controls are
   * missing / extra / out-of-order rather than just the OK/MP/DNF
   * label. All four lists are empty for unmatched cards and for
   * competitors whose class has no course assigned. */
  missing_codes: number[];
  extra_codes: number[];
  out_of_order_codes: number[];
  /** Ordered expected control codes for the competitor's course.
   * Empty array when the competitor's class has no course. */
  expected_codes: number[];
  /** Phase 2.1 (plan 13) — mirrors CompetitorView.manual_status. Non-null
   * when the operator set an override via the manual_status_set event.
   * null means the status is auto-detected (from card_read + course).
   * The UI uses this to distinguish auto-DNF (no clear button) from
   * manual-DNF (clear button visible). */
  manual_status: 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX' | null;
}

/** Pull a displayable name out of the SI card's firmware-side
 * card_holder object. SiCard9/10/11/SIAC parse a semicolon-separated
 * string into { first_name, last_name, ... }; SiCard5 only carries
 * { country_code, club_code } and yields null here. Returns null
 * when the card_holder is empty / not present / has only structural
 * fields. */
function extractCardHolderHint(cardHolder: unknown): string | null {
  if (!cardHolder || typeof cardHolder !== 'object') return null;
  const h = cardHolder as Record<string, unknown>;
  const first = typeof h['first_name'] === 'string' ? (h['first_name'] as string).trim() : '';
  const last = typeof h['last_name'] === 'string' ? (h['last_name'] as string).trim() : '';
  const joined = `${first} ${last}`.trim();
  return joined.length > 0 ? joined : null;
}

interface ReadoutResponse {
  competition_id: string;
  active: boolean;
  current_read: HistoryRow | null;
  history: HistoryRow[];
  pending_unknown_cards: number[];
}

const HISTORY_CAP = 12;

export default async function registerReadoutRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/readout',
    async (req, reply): Promise<ReadoutResponse | undefined> => {
      const { id } = req.params;

      // Pull the last 12 card_read events for this competition, newest
      // first. Order by event_time_ms DESC then local_seq DESC so a tied
      // event_time still produces a deterministic order. Deliberately do
      // NOT 404 on unknown competition (per plan-09 task 2 done criteria
      // test 6): an empty result for a nonexistent competition is the
      // same shape as a real-but-empty competition; downstream plans can
      // layer a 404 if desired.
      const cardReadRows = app.fartolaDb.db
        .select()
        .from(events)
        .where(and(eq(events.competitionId, id), eq(events.eventType, 'card_read')))
        .orderBy(desc(events.eventTimeMs), desc(events.localSeq))
        .limit(HISTORY_CAP)
        .all();

      // Build the card_number → competitor index for this competition.
      const compRows = app.fartolaDb.db
        .select()
        .from(competitorsTable)
        .where(eq(competitorsTable.competitionId, id))
        .all();
      const byCard = new Map<number, (typeof compRows)[number]>();
      for (const c of compRows) {
        if (c.cardNumber !== null) byCard.set(c.cardNumber, c);
      }

      // Source per-event status from the projection cache (or compute on
      // first read). The projection.competitors map keys on competitor_id,
      // and `pending_unknown_cards` is the canonical unknown-card source.
      let projection = app.projectionStore.get(id);
      if (projection === null) projection = app.projectionStore.recomputeNow(id);

      // Phase 2.1 — build a class_id → expected_codes index so each
      // history row can carry the course's expected control list. Two
      // SELECTs: courses for this competition, then one joined SELECT
      // pulling all course_controls × controls for these courses ordered
      // by (course_id, order_idx). Group in TS.
      const courseRows = app.fartolaDb.db
        .select()
        .from(courses)
        .where(eq(courses.competitionId, id))
        .all();
      const expectedByClassId = new Map<string, number[]>();
      if (courseRows.length > 0) {
        const codeRows = app.fartolaDb.db
          .select({
            courseId: courseControls.courseId,
            orderIdx: courseControls.orderIdx,
            code: controls.code,
          })
          .from(courseControls)
          .innerJoin(controls, eq(courseControls.controlId, controls.id))
          .where(eq(controls.competitionId, id))
          .orderBy(desc(courseControls.courseId), desc(courseControls.orderIdx))
          .all();
        const codesByCourse = new Map<string, Array<{ orderIdx: number; code: number }>>();
        for (const c of courseRows) codesByCourse.set(c.id, []);
        for (const r of codeRows) codesByCourse.get(r.courseId)?.push(r);
        for (const [courseId, codes] of codesByCourse) {
          codes.sort((a, b) => a.orderIdx - b.orderIdx);
          const course = courseRows.find((c) => c.id === courseId);
          if (course?.classId !== undefined && course?.classId !== null) {
            expectedByClassId.set(
              course.classId,
              codes.map((c) => c.code)
            );
          }
        }
      }

      // Phase 2.0 Plan 02-05 — build a card_number → open hired_cards row
      // map for this competition so each history row's hired_card_open
      // field comes from a single round-trip rather than a per-card
      // sub-query. The fleet size is small (tens of rentals at 4-klubbs
      // scale) so the in-memory map is cheap.
      const openHiredRows = app.fartolaDb.db
        .select()
        .from(hiredCards)
        .where(and(eq(hiredCards.competitionId, id), isNull(hiredCards.returnedAtMs)))
        .all();
      const openHiredByCard = new Map<
        number,
        {
          contact_name: string | null;
          contact_phone: string | null;
          contact_email: string | null;
          note: string | null;
        }
      >();
      for (const r of openHiredRows) {
        openHiredByCard.set(r.cardNumber, {
          contact_name: r.contactName,
          contact_phone: r.contactPhone,
          contact_email: r.contactEmail,
          note: r.note,
        });
      }

      const history: HistoryRow[] = cardReadRows.map((e) => {
        const payload = e.payload as Extract<EventPayload, { event_type: 'card_read' }>;
        const competitor = byCard.get(payload.card_number);
        const view = competitor && projection ? projection.competitors.get(competitor.id) : null;
        return {
          event_time_ms: e.eventTimeMs,
          local_seq: e.localSeq,
          card_number: payload.card_number,
          card_type: payload.card_type,
          competitor_id: competitor?.id ?? null,
          competitor_name: competitor?.name ?? null,
          status: view?.status ?? 'PEND',
          unmatched: !competitor,
          // PR #3 Gemini medium: surface card_holder firmware string as a
          // hint for walk-up flow. Only emit when there's no competitor
          // binding — for matched cards we already have the real name.
          card_holder_hint: competitor ? null : extractCardHolderHint(payload.card_holder),
          // Phase 2.0 Plan 02-05 — single source of truth for the
          // Hyrbricka toast. Explicit null when the card has no open
          // rental so the SPA can branch without `in` checks.
          hired_card_open: openHiredByCard.get(payload.card_number) ?? null,
          punches: payload.punches.map((p) => ({
            code: p.code,
            seconds_in_half_day: p.seconds_in_half_day,
            half_day: p.half_day,
          })),
          finish_seconds_in_half_day: payload.finish?.seconds_in_half_day ?? null,
          finish_half_day: payload.finish?.half_day ?? null,
          start_seconds_in_half_day: payload.start?.seconds_in_half_day ?? null,
          start_half_day: payload.start?.half_day ?? null,
          // Phase 2.1 — course comparison. `view` is the projected
          // CompetitorView (already computed by the reducer); we just
          // surface its fields plus the static expected_codes from the
          // course → class index built above.
          missing_codes: view?.missing_codes ?? [],
          extra_codes: view?.extra_codes ?? [],
          out_of_order_codes: view?.out_of_order_codes ?? [],
          expected_codes: competitor ? (expectedByClassId.get(competitor.classId) ?? []) : [],
          // Phase 2.1 (plan 13) — expose manual_status so the web client can
          // distinguish auto-DNF (manual_status=null) from operator-set DNF
          // (manual_status='DNF'). Null for unmatched / pre-read cards.
          manual_status: view?.manual_status ?? null,
        };
      });

      const currentRead = history[0] ?? null;
      const pendingUnknownCards = projection?.pending_unknown_cards ?? [];

      // The active flag mirrors the persisted active_competition_id config
      // singleton (the canonical source — sessions.ts writes to it on POST
      // /api/sessions/active-competition). Reading directly from the config
      // table sidesteps Fastify's plugin-scope encapsulation: setting
      // `app.activeCompetitionId` inside the sessions plugin scope does
      // not propagate to sibling plugin scopes (this route). The DB row is
      // a single source of truth that every plugin sees.
      const activeRow = app.fartolaDb.db
        .select({ value: config.value })
        .from(config)
        .where(eq(config.key, ACTIVE_COMP_KEY))
        .get();
      const isActive = (activeRow?.value ?? null) === id;

      const response: ReadoutResponse = {
        competition_id: id,
        active: isActive,
        current_read: currentRead,
        history,
        pending_unknown_cards: pendingUnknownCards,
      };
      void reply.code(200);
      return response;
    }
  );
}
