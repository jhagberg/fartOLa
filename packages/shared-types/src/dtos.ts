// Authored for fartola. Not ported from upstream.
//
// REST DTOs for the Phase 1 edge<->web contract. Real Zod schemas + inferred
// TS types live here so SvelteKit forms (plan 12 wizard + plan 14 walk-up
// modal) and Fastify route handlers share one source of truth at the wire
// boundary. Snake_case at the wire per PATTERNS S-6 + CONTEXT D-15.
//
// Phase 1 schemas:
//   - Competition: CompetitionDTO + CompetitionCreateInput + CompetitionPatchInput
//   - Class:       ClassDTO + ClassCreateInput
//   - Course:      CourseDTO + CourseCreateInput
//   - Competitor:  CompetitorDTO + CompetitorCreateInput
//   - Club:        ClubDTO
//   - Health:      HealthDTO (plan 01 baseline — keep)
//
// Boundary contracts:
//   - REQ-PRIV-001: CompetitorCreateInput requires `consent: true` literal.
//     The server attests `consent_at_ms = Date.now()`; the client cannot
//     backdate consent.
//   - D-15 dates: 'YYYY-MM-DD' string. Regex `^\d{4}-\d{2}-\d{2}$` catches
//     structural failures; SQLite does NOT validate semantic month/day so
//     '2026-13-99' passes the regex by design. UI-SPEC §Visual Anchors —
//     NO locale-dependent date inputs.
//   - C-M4: consent_status arms locked at {explicit, pending_first_read,
//     confirmed_on_read}; CompetitorCreateInput accepts only 'explicit'
//     because walk-up POST is always explicit (the import path in plan 05
//     hits a different code surface).
//   - Receipt template arms locked at UI-SPEC §"Receipt templates" — six
//     names; default 'classic' attached server-side, not via Zod default,
//     so an explicit POST sees an explicit echo of what was stored.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-15
//   (mutable config: competition fields = name + date + receipt_template +
//   auto_print; D-04 walk-up first-class registration)
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-11
//   (hybrid card-to-competitor matching — cardNumber persisted on
//   competitor row; reducer in plan 07 reads from this column)
// - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md §S-6
//   (snake_case at the I/O boundary; camelCase inside TS bodies)
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-M4
//   (consent_status arms; walk-up = 'explicit')
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §"Auto-print
//   toggle" (event-level, persisted on competitions row)
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §"Walk-up
//   modal" (name minLength 2, klubb optional autocomplete, klass required,
//   bricka optional integer)
// - REQ-PRIV-001 (explicit consent literal on walk-up POST)

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared atoms — used across multiple schemas, declared once.
// ---------------------------------------------------------------------------

/** UUID string (any version). Hand-rolled `regex` instead of `z.uuid()` so the
 * generated error path stays `path: 'id'` rather than `path: 'id'` plus a
 * Zod-format token; the REST tests grep on `path` for assertions. The regex
 * mirrors RFC 4122 v1-v8 + the v0 nil UUID; it accepts both lowercase and
 * uppercase hex. */
const UUID = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'expected UUID'
  );

/** ISO date 'YYYY-MM-DD'. CONTEXT D-15 + UI-SPEC §Visual Anchors lock the
 * wire shape; SQLite does not validate semantic month/day, so '2026-13-99'
 * passes by design (the regex is purely structural). */
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** UI-SPEC §"Receipt templates" — six template names locked. */
const RECEIPT_TEMPLATE = z.enum(['classic', 'standing', 'detailed', 'top4', 'minimal', 'kids']);

/** Positive integer (>= 1). Used for card_number + course controls. */
const POSITIVE_INT = z.number().int().positive();

// ---------------------------------------------------------------------------
// Competition — D-15 locks four mutable fields: name, date, receipt_template,
// auto_print. UI-SPEC §"Receipt template DEFAULT" pins default to 'classic';
// UI-SPEC §"Auto-print toggle" defaults auto_print to false (OFF).
// ---------------------------------------------------------------------------

export const CompetitionDTO = z.object({
  id: UUID,
  name: z.string().min(1),
  date: ISO_DATE,
  receipt_template: RECEIPT_TEMPLATE,
  auto_print: z.boolean(),
  created_at_ms: z.number().int().nonnegative(),
  /** Phase 2.1 race-phase gate. NULL = pre-race (card_reads are
   * identity scans only); ms-epoch = race has started at that wall
   * clock instant. Frontend uses this to render the phase pill and
   * enable/disable the "Starta tävling" CTA. */
  race_started_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompetitionDTO = z.infer<typeof CompetitionDTO>;

export const CompetitionCreateInput = z.object({
  name: z.string().min(1).max(200),
  date: ISO_DATE,
  receipt_template: RECEIPT_TEMPLATE.optional(),
  auto_print: z.boolean().optional(),
});
export type CompetitionCreateInput = z.infer<typeof CompetitionCreateInput>;

export const CompetitionPatchInput = z.object({
  name: z.string().min(1).max(200).optional(),
  date: ISO_DATE.optional(),
  receipt_template: RECEIPT_TEMPLATE.optional(),
  auto_print: z.boolean().optional(),
});
export type CompetitionPatchInput = z.infer<typeof CompetitionPatchInput>;

// ---------------------------------------------------------------------------
// Class — mutable config table, always nested under a competition.
// ---------------------------------------------------------------------------

export const ClassDTO = z.object({
  id: UUID,
  competition_id: UUID,
  name: z.string().min(1),
  short_name: z.string().nullable(),
});
export type ClassDTO = z.infer<typeof ClassDTO>;

export const ClassCreateInput = z.object({
  name: z.string().min(1).max(120),
  short_name: z.string().max(40).nullable().optional(),
});
export type ClassCreateInput = z.infer<typeof ClassCreateInput>;

// ---------------------------------------------------------------------------
// Course — controls embedded as { control_code, order_idx } pairs at the wire
// boundary (mirrors the joined SELECT in routes/courses.ts). class_id is
// nullable because XML import (D-03) may assign later.
// ---------------------------------------------------------------------------

export const CourseControlDTO = z.object({
  control_code: POSITIVE_INT,
  order_idx: z.number().int().nonnegative(),
});
export type CourseControlDTO = z.infer<typeof CourseControlDTO>;

export const CourseDTO = z.object({
  id: UUID,
  competition_id: UUID,
  name: z.string().min(1),
  class_id: UUID.nullable(),
  length_m: z.number().int().nullable(),
  climb_m: z.number().int().nullable(),
  controls: z.array(CourseControlDTO),
});
export type CourseDTO = z.infer<typeof CourseDTO>;

export const CourseCreateInput = z.object({
  name: z.string().min(1).max(120),
  class_id: UUID.nullable().optional(),
  length_m: z.number().int().nullable().optional(),
  climb_m: z.number().int().nullable().optional(),
  controls: z.array(CourseControlDTO),
});
export type CourseCreateInput = z.infer<typeof CourseCreateInput>;

// ---------------------------------------------------------------------------
// Competitor — REQ-PRIV-001 enforces `consent: true` literal. C-M4 locks the
// three consent_status arms; walk-up POST is always 'explicit' so the create
// input accepts only that arm (or omits it for the server default).
//
// UI-SPEC §"Walk-up modal" form contract:
//   - name:        required, min 2 chars
//   - klubb/club:  optional autocomplete
//   - klass:       required (class_id)
//   - bricka/card: optional integer (card_number)
// ---------------------------------------------------------------------------

export const CompetitorDTO = z.object({
  id: UUID,
  competition_id: UUID,
  name: z.string(),
  club: z.string().nullable(),
  class_id: UUID,
  card_number: POSITIVE_INT.nullable(),
  consent_at_ms: z.number().int().nonnegative().nullable(),
  consent_status: z.enum(['explicit', 'pending_first_read', 'confirmed_on_read']),
  scrubbed_at_ms: z.number().int().nullable(),
});
export type CompetitorDTO = z.infer<typeof CompetitorDTO>;

/**
 * Walk-up POST input — two modes selected by presence of
 * `replace_card_for_competitor_id`:
 *
 *   - **Create mode (default — D-04 walk-up first-class):** name +
 *     class_id + consent are required; the handler inserts a brand-new
 *     competitor row plus optional card_bound event.
 *   - **Replace mode (plan 10):** the operator notices a misread Bricka
 *     and corrects it without creating a duplicate row. Only
 *     `card_number` is required at the wire; the handler UPDATEs the
 *     existing competitor row's card_number and emits a card_bound event
 *     preserving the original `consent_at_ms` (REQ-PRIV-001 — consent
 *     was already given at walk-up; only the card number is corrected).
 *
 * **Zod superRefine + optional() quirk:** every per-mode field is
 * declared `.optional()` at the base shape so the base-layer parse never
 * errors on a missing key — `superRefine` then enforces the per-mode
 * required set with explicit `path` strings. Putting `.min(2)` directly
 * on an `.optional()` field is fine (the constraint only fires when the
 * value is present; missing keys skip it). The custom issues fall
 * through `issuesToErrors` unchanged so the SvelteKit form sees the
 * same { path, code, message } shape as the structural failures.
 */
export const CompetitorCreateInput = z
  .object({
    competition_id: UUID,
    /** UI-SPEC §"Walk-up modal" — minLength 2. `.trim()` normalises
     * trailing whitespace before length is checked. Optional at the base
     * layer; the superRefine below enforces presence in create mode. */
    name: z.string().trim().min(2).max(200).optional(),
    /** Optional autocomplete. Empty string + missing key both collapse
     * to null via the transform so the DB sees a single shape. */
    club: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    /** Optional at the base layer; superRefine enforces in create mode. */
    class_id: UUID.optional(),
    card_number: POSITIVE_INT.nullable()
      .optional()
      .transform((v) => v ?? null),
    /** REQ-PRIV-001 — explicit consent literal in create mode. Replace
     * mode does NOT require re-consent (the original row's
     * consent_at_ms is preserved). */
    consent: z.literal(true).optional(),
    /** C-M4: walk-up POST is always 'explicit'. Omitted = server
     * default 'explicit' (mirrors the schema column DEFAULT from
     * plan 02). */
    consent_status: z.literal('explicit').optional(),
    /** Plan 10 — when set, the POST handler UPDATEs the named
     * competitor's card_number (operator-corrected misread) instead of
     * creating a new row. consent_at_ms is preserved. */
    replace_card_for_competitor_id: UUID.optional(),
    /** Phase 2.0 D-HB-1 / Plan 02-02 — when true, the route ALSO writes
     * a `hired_cards` row inside the same transaction as the competitor
     * INSERT. Default false preserves the Phase 1 wire shape exactly. */
    hired_card: z.boolean().optional().default(false),
    /** Phase 2.0 D-HB-3 — contact info for the rental. Required when
     * `hired_card === true` AND at least one of phone OR email must be
     * non-null non-empty (server-side; the UI also blocks save but the
     * server is authoritative). */
    hired_contact: z
      .object({
        name: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        note: z.string().nullable(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.replace_card_for_competitor_id !== undefined) {
      // Replace mode: card_number is the only required field.
      if (val.card_number === null || val.card_number === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['card_number'],
          message: 'card_number required for replace',
        });
      }
    } else {
      // Create mode (default): name + class_id + consent literal required.
      if (val.name === undefined) {
        ctx.addIssue({ code: 'custom', path: ['name'], message: 'name required' });
      }
      if (val.class_id === undefined) {
        ctx.addIssue({ code: 'custom', path: ['class_id'], message: 'class_id required' });
      }
      if (val.consent !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['consent'],
          message: 'consent required',
        });
      }
    }
  });
export type CompetitorCreateInput = z.infer<typeof CompetitorCreateInput>;

// ---------------------------------------------------------------------------
// Plan 10 — manual DNF override + un-DNF reversal.
//
// REST inputs for POST /api/competitions/:id/competitors/:competitorId/manual-dnf
// and .../un-dnf. The un-DNF endpoint takes no body; the schema is exported
// for symmetry with ManualDnfInput so SvelteKit can declare both `import`
// types together (plan 13 readout view).
//
// UI-SPEC §"Manual DNF override": the reason field is operator-typed,
// length-capped at 500 to fit the receipt template + readout-row tooltip.
// ---------------------------------------------------------------------------

export const ManualDnfInput = z.object({
  reason: z.string().min(1).max(500),
});
export type ManualDnfInput = z.infer<typeof ManualDnfInput>;

/** Un-DNF takes no body (presence of the POST is the action). Exported as a
 * passthrough object so SvelteKit `import type` consumers can reference a
 * matching name; the route handler does NOT parse the body. */
export const UnDnfInput = z.object({}).passthrough();
export type UnDnfInput = z.infer<typeof UnDnfInput>;

// ---------------------------------------------------------------------------
// Phase 2.0 — generalized manual status override.
//
// REST input for POST /api/competitions/:id/competitors/:competitorId/status.
// Lets the operator assert any of the five manual states (DNF/DNS/DQ/CANCEL/
// MAX). The legacy /manual-dnf endpoint stays available for back-compat;
// internally both write to the same view.manual_status field.
//
// IOF v3 mapping (apps/edge/src/xml/iofExport.ts):
//   DNF → DidNotFinish | DNS → DidNotStart | DQ → Disqualified
//   CANCEL → Cancelled | MAX → OverTime
// ---------------------------------------------------------------------------

export const ManualStatusInput = z.object({
  status: z.enum(['DNF', 'DNS', 'DQ', 'CANCEL', 'MAX']),
  reason: z.string().min(1).max(500),
});
export type ManualStatusInput = z.infer<typeof ManualStatusInput>;

/** Clearing the override takes no body — symmetric with UnDnfInput. Strict
 * so unexpected body fields are rejected (02-11 LOW: was passthrough()). */
export const ClearManualStatusInput = z.object({}).strict();
export type ClearManualStatusInput = z.infer<typeof ClearManualStatusInput>;

// ---------------------------------------------------------------------------
// Phase 2.1 (D-16) — voided-leg REST inputs.
//
// POST /api/competitions/:id/competitors/:cid/void-leg
//   body: { control_code: number, max_seconds: number | null, reason?: string }
//
// POST /api/competitions/:id/competitors/:cid/unvoid-leg
//   body: { control_code: number }
// ---------------------------------------------------------------------------

export const VoidLegInput = z.object({
  control_code: z.number().int().positive(),
  max_seconds: z.number().int().positive().nullable(),
  reason: z.string().max(500).optional(),
});
export type VoidLegInput = z.infer<typeof VoidLegInput>;

export const UnvoidLegInput = z.object({
  control_code: z.number().int().positive(),
});
export type UnvoidLegInput = z.infer<typeof UnvoidLegInput>;

// ---------------------------------------------------------------------------
// Club — walk-up autocomplete cache.
// ---------------------------------------------------------------------------

export const ClubDTO = z.object({
  name: z.string(),
  last_seen_at_ms: z.number().int().nonnegative(),
});
export type ClubDTO = z.infer<typeof ClubDTO>;

// ---------------------------------------------------------------------------
// Phase 2.0 Plan 02-02 — Eventor walk-up autocomplete shapes.
//
// GET /api/eventor/lookup?si_card=N → EventorLookupResult (discriminated
//   on hit: true (single) | 'many' (ambiguous) | false (miss)).
// GET /api/eventor/lookup?prefix=S → { suggestions: EventorNameSuggestion[] }.
// GET /api/eventor/status → EventorStatusDTO.
//
// 2026-05-20: si_card is non-unique in the cache schema (family-shared
// cards, replacement cards, rental pool) so the API can return >1 candidate
// for one number. Callers MUST disambiguate before pre-filling — auto-
// picking one row would silently fill the wrong runner.
// ---------------------------------------------------------------------------

export const EventorLookupCandidate = z.object({
  person_id: z.number().int().positive(),
  family_name: z.string(),
  given_name: z.string(),
  club_id: z.number().int().nullable(),
  club_name: z.string().nullable(),
});
export type EventorLookupCandidate = z.infer<typeof EventorLookupCandidate>;

export const EventorLookupHit = EventorLookupCandidate.extend({
  hit: z.literal(true),
  /** Number of alternative Eventor competitors for the same SI card that were
   * NOT selected by the disambiguation algorithm. 0 = unique match (no
   * ambiguity). >0 = resolved by recency/context but alternatives exist.
   * The WalkupModal renders a "+N andra chip" when this is >0. */
  alternatives: z.number().int().min(0),
  /** All candidates including the winner, populated when alternatives > 0.
   * Used by the WalkupModal chip popover without a second round-trip. */
  allCandidates: z.array(EventorLookupCandidate),
});
export type EventorLookupHit = z.infer<typeof EventorLookupHit>;

export const EventorLookupMany = z.object({
  hit: z.literal('many'),
  candidates: z.array(EventorLookupCandidate),
});
export type EventorLookupMany = z.infer<typeof EventorLookupMany>;

export const EventorLookupMiss = z.object({ hit: z.literal(false) });
export type EventorLookupMiss = z.infer<typeof EventorLookupMiss>;

export type EventorLookupResult = EventorLookupHit | EventorLookupMany | EventorLookupMiss;

export const EventorNameSuggestion = z.object({
  person_id: z.number().int().positive(),
  family_name: z.string(),
  given_name: z.string(),
  club_name: z.string().nullable(),
  si_card: z.number().int().nullable(),
});
export type EventorNameSuggestion = z.infer<typeof EventorNameSuggestion>;

/** Federation-club autocomplete row served by GET /api/eventor/clubs?q=.
 * Backed by the eventor_clubs_fts FTS5 mirror — matches across name +
 * short_name + media_name with diacritic folding so "stk", "stora tuna",
 * and "stortuna" all resolve to the same row. */
export const EventorClubSuggestion = z.object({
  club_id: z.number().int().positive(),
  name: z.string(),
  short_name: z.string().nullable(),
  media_name: z.string().nullable(),
});
export type EventorClubSuggestion = z.infer<typeof EventorClubSuggestion>;

export const EventorStatusDTO = z.object({
  state: z.enum(['ready', 'stale', 'offline', 'no_key']),
  ageDays: z.number().int().nullable(),
  competitorCount: z.number().int().nonnegative(),
  /** Phase 2.0 Plan 02-07 task 2 — source of the resolved EVENTOR_API_KEY.
   * 'env' = process.env wins (~/.env.fartola / CLI export); 'config' = UI
   * wrote it via PUT /api/settings/integrations; 'absent' = neither set
   * (paired with state='no_key'). SettingsView reads this to render the
   * "Värdet kommer från ~/.env.fartola …" banner so the operator knows
   * env will trump any UI save on next boot. */
  source: z.enum(['env', 'config', 'absent']),
  fartola_dev: z.boolean(),
});
export type EventorStatusDTO = z.infer<typeof EventorStatusDTO>;

// ---------------------------------------------------------------------------
// Phase 2.0 Plan 02-05 — Hyrbricka (hired card) REST shapes.
//
// GET   /api/competitions/:id/hired-cards
//   → { open: HiredCardRow[], returned: HiredCardRow[] }
//   Backs the admin "Aktiva hyrbrickor" view; ReadoutView reads
//   hired_card_open from /readout instead (single source of truth).
//
// PATCH /api/competitions/:id/hired-cards/:cardNumber/return
//   → 200 { ok: true, returned_at_ms: number, already_returned?: boolean }
//   → 404 { error: 'not_found' }
//   Idempotent: second PATCH preserves the original timestamp.
// ---------------------------------------------------------------------------

export const HiredCardRow = z.object({
  competition_id: UUID,
  card_number: POSITIVE_INT,
  marked_at_ms: z.number().int().nonnegative(),
  returned_at_ms: z.number().int().nonnegative().nullable(),
  /** PII per REQ-PRIV-002 — scrubbed by privacy/retention.ts after 30 days. */
  contact_name: z.string().nullable(),
  /** PII per REQ-PRIV-002. */
  contact_phone: z.string().nullable(),
  /** PII per REQ-PRIV-002. */
  contact_email: z.string().nullable(),
  /** PII per REQ-PRIV-002 — free-form operator note. */
  note: z.string().nullable(),
});
export type HiredCardRow = z.infer<typeof HiredCardRow>;

export const HiredCardsListResponse = z.object({
  open: z.array(HiredCardRow),
  returned: z.array(HiredCardRow),
});
export type HiredCardsListResponse = z.infer<typeof HiredCardsListResponse>;

export const HiredCardReturnResponse = z.object({
  ok: z.literal(true),
  returned_at_ms: z.number().int().nonnegative(),
  already_returned: z.boolean().optional(),
});
export type HiredCardReturnResponse = z.infer<typeof HiredCardReturnResponse>;

/** Per-row payload on the readout history when a card has an open
 * hired_cards entry. Drives the Hyrbricka finish-readout toast. */
export const HiredCardOpen = z.object({
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  note: z.string().nullable(),
});
export type HiredCardOpen = z.infer<typeof HiredCardOpen>;

// ---------------------------------------------------------------------------
// Health — plan 01 baseline. Plan 04 adds per-reader status (REQ-OPS-004).
// ---------------------------------------------------------------------------

export const ReaderStatusDTO = z.object({
  path: z.string(),
  position: z.string().nullable(),
  connected: z.boolean(),
  /** Epoch-ms of the last card_read event on this reader, or null if none
   * since boot. */
  last_punch_at: z.number().int().nullable(),
});
export type ReaderStatusDTO = z.infer<typeof ReaderStatusDTO>;

export const HealthDTO = z.object({
  status: z.literal('ok'),
  node_id: z.string(),
  uptime_ms: z.number(),
  /** Plan 04 (D-01 / REQ-OPS-004) — per-reader status. Empty array when
   * --no-bridge is set. One entry per --serial flag. */
  readers: z.array(ReaderStatusDTO),
});
export type HealthDTO = z.infer<typeof HealthDTO>;
