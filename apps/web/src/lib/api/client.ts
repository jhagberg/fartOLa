// Authored for fartola. Not ported from upstream.
//
// Typed REST client wrapper for the Phase 1 edge<->web contract. Functions
// are 1:1 with the Fastify route handlers in apps/edge/src/routes/*; the
// shapes come from @fartola/shared-types so a wire-side change forces a
// type error here before the form sees runtime garbage.
//
// JSON-only by default (`apiFetch`). The single multipart caller —
// `importCompetitionFile` — bypasses the helper and uses FormData so the
// browser sets the Content-Type boundary itself.
//
// Errors: any non-2xx response throws `ApiError` carrying the parsed JSON
// body when available. Callers can `instanceof ApiError` to distinguish
// from network failures (which surface as raw fetch errors).
//
// Locked by:
// - 01-11-PLAN.md task 2 (function inventory)
// - 01-PATTERNS.md §S-6 (snake_case at the I/O boundary)
// - Endpoint surface from apps/edge/src/routes/ (verified 2026-05-14)

import type {
  CompetitionDTO,
  CompetitionCreateInput,
  CompetitionPatchInput,
  CompetitorDTO,
  CompetitorCreateInput,
  ClassDTO,
  ClassCreateInput,
  CourseDTO,
  CourseCreateInput,
  ClubDTO,
  EventorLookupResult,
  EventorNameSuggestion,
  EventorClubSuggestion,
  EventorStatusDTO,
  HiredCardsListResponse,
  HiredCardReturnResponse,
  HealthDTO,
} from '@fartola/shared-types';

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Thrown on any non-2xx response. `body` is the parsed JSON if the server
 * returned one; `text` is the raw response text as a fallback. Callers can
 * branch on `status` for 404 vs 422 vs 5xx without re-parsing. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  constructor(status: number, message: string, body: unknown, text: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.text = text;
  }
}

// ---------------------------------------------------------------------------
// Base helper
// ---------------------------------------------------------------------------

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

/** Compose a URL with query string when params are supplied. */
function withQuery(path: string, query?: ApiFetchOptions['query']): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

/** JSON fetch wrapper. Throws ApiError on non-2xx, returns parsed JSON on 2xx,
 * returns `undefined as T` on 204 No Content. */
async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const url = withQuery(path, opts.query);
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : null) ?? `HTTP ${res.status} on ${opts.method ?? 'GET'} ${path}`;
    throw new ApiError(res.status, message, parsed, text);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function getHealth(): Promise<HealthDTO> {
  return apiFetch<HealthDTO>('/api/health');
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

export function listCompetitions(): Promise<{ competitions: CompetitionDTO[] }> {
  return apiFetch<{ competitions: CompetitionDTO[] }>('/api/competitions');
}

export function getCompetition(
  id: string
): Promise<{ competition: CompetitionDTO; classes: ClassDTO[]; courses: CourseDTO[] }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(id)}`);
}

export function createCompetition(body: CompetitionCreateInput): Promise<CompetitionDTO> {
  return apiFetch<CompetitionDTO>('/api/competitions', { method: 'POST', body });
}

export function patchCompetition(id: string, body: CompetitionPatchInput): Promise<CompetitionDTO> {
  return apiFetch<CompetitionDTO>(`/api/competitions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}

/** Phase 2.1 — flip the race-phase gate. Idempotent: returns the existing
 * competition row (with race_started_at_ms already set) on a duplicate
 * call instead of resetting the start time. */
export function startRace(id: string): Promise<CompetitionDTO> {
  return apiFetch<CompetitionDTO>(`/api/competitions/${encodeURIComponent(id)}/start-race`, {
    method: 'POST',
    body: {},
  });
}

/** Phase 2.1 — rollback the race-phase gate. Operator hits this when the
 * race was started by mistake (testing, demo). Idempotent: already-in-pre-
 * race returns the same row without writing a new event. */
export function resetRace(id: string): Promise<CompetitionDTO> {
  return apiFetch<CompetitionDTO>(`/api/competitions/${encodeURIComponent(id)}/reset-race`, {
    method: 'POST',
    body: {},
  });
}

// ---------------------------------------------------------------------------
// Wizard atomic create + XML ingest (C-H3 LOCKED — plan 12)
// ---------------------------------------------------------------------------
//
// The three-click wizard fires ONE POST to /api/competitions/from-wizard.
// Per Codex review C-H3: HTTP requests cannot share a SQL transaction, so
// the old two-call shape (createCompetition + importCompetitionFile) was
// eligible for partial commit — an XSD failure after the competition
// INSERT would leave an orphan row. The atomic endpoint wraps both
// operations in one SQLite transaction; on any failure NO orphan row
// persists. wizard.spec.ts test 2 is the e2e regression gate.

export interface CreateFromWizardInput {
  name: string;
  date: string;
  xml_file: { name: string; content_base64: string };
  /** Plan 11 — optional Eventor event ID to link on creation. */
  eventor_event_id?: number | null;
}

export interface CreateFromWizardOk {
  competition_id: string;
  kind: 'CourseData' | 'EntryList';
  classes_created?: number;
  controls_created?: number;
  courses_created?: number;
  competitors_created?: number;
  classes_missing?: string[];
  [extra: string]: unknown;
}

export interface CreateFromWizardErr {
  error: string;
  message?: string;
  errors?: Array<{ line?: number; column?: number; message: string }>;
  detail?: string;
}

/** Plan 12 wizard endpoint: ONE atomic POST that creates the competition
 * and ingests the XML in a single SQL transaction (C-H3). Returns a
 * tagged union so callers branch on `ok` without `instanceof ApiError`
 * (the regression gate cares about the body shape, not the exception). */
export async function createCompetitionFromWizard(
  input: CreateFromWizardInput
): Promise<
  { ok: true; data: CreateFromWizardOk } | { ok: false; status: number; data: CreateFromWizardErr }
> {
  const res = await fetch('/api/competitions/from-wizard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    parsed = { error: 'parse_failed', detail: text };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, data: parsed as CreateFromWizardOk };
  }
  return { ok: false, status: res.status, data: parsed as CreateFromWizardErr };
}

// ---------------------------------------------------------------------------
// Classes + Courses (per-competition)
// ---------------------------------------------------------------------------

export function listClasses(competitionId: string): Promise<{ classes: ClassDTO[] }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/classes`);
}

export function createClass(competitionId: string, body: ClassCreateInput): Promise<ClassDTO> {
  return apiFetch<ClassDTO>(`/api/competitions/${encodeURIComponent(competitionId)}/classes`, {
    method: 'POST',
    body,
  });
}

export function listCourses(competitionId: string): Promise<{ courses: CourseDTO[] }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/courses`);
}

export function createCourse(competitionId: string, body: CourseCreateInput): Promise<CourseDTO> {
  return apiFetch<CourseDTO>(`/api/competitions/${encodeURIComponent(competitionId)}/courses`, {
    method: 'POST',
    body,
  });
}

// ---------------------------------------------------------------------------
// Competitors (walk-up D-04)
// ---------------------------------------------------------------------------

export function listCompetitors(competitionId: string): Promise<{ competitors: CompetitorDTO[] }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/competitors`);
}

/** Lookup the (at most one) competitor bound to a given SI card in this
 * competition. Returns an empty competitors[] when no binding exists. The
 * partial unique index on (competition_id, card_number) WHERE card_number
 * IS NOT NULL guarantees at most one match. */
export function lookupCompetitorByCard(
  competitionId: string,
  cardNumber: number
): Promise<{ competitors: CompetitorDTO[] }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors?card_number=${encodeURIComponent(cardNumber)}`
  );
}

export function getCompetitor(
  competitionId: string,
  competitorId: string
): Promise<{ competitor: CompetitorDTO }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}`
  );
}

/** Walk-up create + plan-10 replace-card share this entry point; the
 * `replace_card_for_competitor_id` field switches mode server-side.
 *
 * Level-A mobile resilience (2026-05-17): on a raw network failure
 * (TypeError from fetch — wifi dropped, DNS hiccup, AP roam) do ONE
 * automatic retry with a 1500 ms back-off. We never retry on an ApiError
 * (the server got it and responded — 4xx is deterministic, 5xx is a real
 * bug). The form survives the failure either way; this just absorbs the
 * common case where the operator wouldn't otherwise notice the blip.
 *
 * Durable outbox + server-side idempotency is the Level-B follow-up at
 * `.planning/todos/pending/2026-05-17-mobile-registration-outbox-idempotency.md`. */
export async function createCompetitor(body: CompetitorCreateInput): Promise<CompetitorDTO> {
  try {
    return await apiFetch<CompetitorDTO>('/api/competitors', { method: 'POST', body });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Raw fetch failure — wait briefly then retry once.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return apiFetch<CompetitorDTO>('/api/competitors', { method: 'POST', body });
  }
}

/** Edit name / club / class / card on an existing competitor row. Distinct
 * from `confirmConsent` (different PATCH path); operator-driven correction
 * surface. All fields optional; an empty body is a no-op 200. */
export interface CompetitorProfilePatch {
  name?: string;
  club?: string | null;
  class_id?: string;
  card_number?: number | null;
}

export function editCompetitorProfile(
  competitorId: string,
  body: CompetitorProfilePatch
): Promise<{ ok: true; competitor: CompetitorDTO }> {
  return apiFetch<{ ok: true; competitor: CompetitorDTO }>(
    `/api/competitors/${encodeURIComponent(competitorId)}/profile`,
    { method: 'PATCH', body }
  );
}

// ---------------------------------------------------------------------------
// Consent confirmation (C-M4) — PATCH /api/competitors/:id
// ---------------------------------------------------------------------------
//
// One-time consent confirmation flip for EntryList-imported competitors
// (consent_status='pending_first_read' → 'confirmed_on_read'). Returns a
// tagged union so the toast component can branch without `instanceof
// ApiError` — the surface is intentionally narrow (200 ok / non-2xx with
// JSON body).

export async function confirmConsent(
  competitorId: string
): Promise<
  | { ok: true; data: { ok: true; competitor_id: string } }
  | { ok: false; status: number; data: { error: string; message?: string; current?: string } }
> {
  const res = await fetch(`/api/competitors/${encodeURIComponent(competitorId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consent_status: 'confirmed_on_read',
      consent_at_ms: Date.now(),
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    parsed = { error: 'parse_failed' };
  }
  if (res.status === 200) {
    return { ok: true, data: parsed as { ok: true; competitor_id: string } };
  }
  return {
    ok: false,
    status: res.status,
    data: parsed as { error: string; message?: string; current?: string },
  };
}

// ---------------------------------------------------------------------------
// Manual DNF + un-DNF (plan 10)
// ---------------------------------------------------------------------------

export function manualDnf(
  competitionId: string,
  competitorId: string,
  reason: string
): Promise<{ local_seq: number }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}/manual-dnf`,
    { method: 'POST', body: { reason } }
  );
}

export function unDnf(competitionId: string, competitorId: string): Promise<{ local_seq: number }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}/un-dnf`,
    { method: 'POST', body: {} }
  );
}

// ---------------------------------------------------------------------------
// Phase 2.0 — generalized manual-status override (DNS/DQ/CANCEL/MAX + DNF).
// The legacy manualDnf() above stays for back-compat; new operator UI should
// call setManualStatus() so the operator can pick any of the five states.
// ---------------------------------------------------------------------------

export type ManualStatus = 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

export function setManualStatus(
  competitionId: string,
  competitorId: string,
  status: ManualStatus,
  reason: string
): Promise<{ local_seq: number }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}/status`,
    { method: 'POST', body: { status, reason } }
  );
}

export function clearManualStatus(
  competitionId: string,
  competitorId: string
): Promise<{ local_seq: number }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}/clear-status`,
    { method: 'POST', body: {} }
  );
}

// ---------------------------------------------------------------------------
// Import (multipart) — Course XML + IOF XML 3.0 entries
// ---------------------------------------------------------------------------

export async function importCompetitionFile(
  competitionId: string,
  file: File
): Promise<{ kind: 'CourseData' | 'EntryList'; [k: string]: unknown }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/competitions/${encodeURIComponent(competitionId)}/import`, {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status} on import`;
    throw new ApiError(res.status, message, parsed, text);
  }
  return parsed as { kind: 'CourseData' | 'EntryList'; [k: string]: unknown };
}

// ---------------------------------------------------------------------------
// Readout + Results (projection-store reads)
// ---------------------------------------------------------------------------

/** Readout view payload — strongly-typed once plan 13 lands; for now the
 * shape is unknown to keep this client free of plan-13 internals. */
export function getReadout(competitionId: string): Promise<unknown> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/readout`);
}

export function getResults(competitionId: string): Promise<unknown> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/results`);
}

// ---------------------------------------------------------------------------
// Print (plan 15) — ESC/POS thermal print for the 6 receipt templates.
// ---------------------------------------------------------------------------

export type ReceiptTemplateId = 'classic' | 'standing' | 'detailed' | 'top4' | 'minimal' | 'kids';

/** POST /api/competitions/:id/print-receipt — queue an ESC/POS print job
 * (template defaults to competition.receipt_template when omitted). The
 * server resolves the projection / placeContext / skogisStats; the
 * client never carries any of that. Returns the queue position so the
 * UI can show a toast that distinguishes "printing" from "queued behind
 * N prints". */
export function printReceipt(
  competitionId: string,
  competitorId: string,
  template?: ReceiptTemplateId
): Promise<{ queued: boolean; queue_position: number }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/print-receipt`, {
    method: 'POST',
    body: {
      competitor_id: competitorId,
      ...(template !== undefined ? { template } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Export (plan 16) — IOF XML 3.0 ResultList preview + download URL.
// ---------------------------------------------------------------------------
//
// The preview endpoint returns a JSON summary of the validation pass; the
// UI uses it to populate the green check / red error box on the export
// page. The download URL is the GET that the browser navigates to so the
// `Content-Disposition: attachment` header triggers a native file save.

export type ExportStatus = 'Final' | 'Provisional';

export interface ExportPreviewSummary {
  class_count: number;
  person_result_count: number;
  status: ExportStatus;
}

export interface ExportPreviewError {
  line?: number | null;
  column?: number | null;
  message: string;
}

export type ExportPreviewResult =
  | { valid: true; summary: ExportPreviewSummary }
  | { valid: false; errors: ExportPreviewError[] };

/** Preview the IOF XML 3.0 export for a competition. Returns valid=true
 * with summary counts on XSD pass, or valid=false with line-numbered
 * errors. The download CTA is gated on valid=true. */
export function exportPreview(
  competitionId: string,
  status: ExportStatus
): Promise<ExportPreviewResult> {
  return apiFetch<ExportPreviewResult>(
    `/api/competitions/${encodeURIComponent(competitionId)}/export/preview`,
    { query: { status } }
  );
}

/** Build the download URL for the IOF XML 3.0 export. The browser handles
 * the actual download via Content-Disposition: attachment; the UI just
 * navigates to this URL on the CTA click. */
export function exportDownloadUrl(competitionId: string, status: ExportStatus): string {
  return `/api/competitions/${encodeURIComponent(competitionId)}/export?format=iof30&status=${status}`;
}

// ---------------------------------------------------------------------------
// Clubs (walk-up autocomplete cache)
// ---------------------------------------------------------------------------

export function listClubs(prefix?: string, limit?: number): Promise<{ clubs: ClubDTO[] }> {
  return apiFetch('/api/clubs', {
    ...(prefix !== undefined
      ? { query: { prefix, ...(limit !== undefined ? { limit } : {}) } }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Eventor walk-up autocomplete (Phase 2.0 Plan 02-02).
// ---------------------------------------------------------------------------

/** GET /api/eventor/lookup?si_card=N — cache lookup for the bricka-scan
 * pre-fill flow. Returns { hit: true, alternatives: N, ... } for a resolved
 * match (unique or recency/context resolved), { hit: 'many', candidates } when
 * same-competition disambiguation is needed, or { hit: false }.
 *
 * Pass `competitionId` to enable context-aware disambiguation: the backend will
 * prefer a runner registered in that competition and return 'many' if multiple
 * are registered for the same card. */
export function lookupEventorBySiCard(
  siCard: number,
  competitionId?: string | null
): Promise<EventorLookupResult> {
  return apiFetch<EventorLookupResult>('/api/eventor/lookup', {
    query: competitionId ? { si_card: siCard, competition_id: competitionId } : { si_card: siCard },
  });
}

/** GET /api/eventor/lookup?prefix=S&limit=K — name-prefix autocomplete
 * for the operator-types-name flow. Caller MUST enforce minLength 2 on
 * the prefix (the 252k-row scan blows the autocomplete UX otherwise);
 * the API tolerates shorter prefixes but UI patterns reject them. */
export function lookupEventorByPrefix(
  prefix: string,
  limit: number = 20
): Promise<{ suggestions: EventorNameSuggestion[] }> {
  return apiFetch<{ suggestions: EventorNameSuggestion[] }>('/api/eventor/lookup', {
    query: { prefix, limit },
  });
}

/** FTS5-backed competitor search. Folds diacritics, matches across
 * family + given + club_name in any word order. Use this for new code
 * (the Lägg-till sheet) — `lookupEventorByPrefix` stays for back-compat
 * with WalkupModal.
 *
 * When `clubId` is supplied, the result set is hard-narrowed to that
 * federation club. The Lägg-till sheet passes this once the operator
 * has picked a club so a common name like "Per Karlsson" returns the
 * in-club match instead of being ranked-out by homonyms from other
 * clubs. */
export function searchEventorCompetitors(
  q: string,
  limit: number = 20,
  clubId?: number
): Promise<{ suggestions: EventorNameSuggestion[] }> {
  const query: Record<string, string | number> = { q, limit };
  if (clubId !== undefined) query['club_id'] = clubId;
  return apiFetch<{ suggestions: EventorNameSuggestion[] }>('/api/eventor/lookup', {
    query,
  });
}

/** GET /api/eventor/clubs?q= — federation-club search backed by FTS5.
 * Matches name + short_name + media_name in any word order with
 * diacritic folding, so "stk" / "stora tuna" / "stortuna" all hit
 * Stora Tuna OK. */
export function searchEventorClubs(
  q: string,
  limit: number = 20
): Promise<{ suggestions: EventorClubSuggestion[] }> {
  return apiFetch<{ suggestions: EventorClubSuggestion[] }>('/api/eventor/clubs', {
    query: { q, limit },
  });
}

/** GET /api/eventor/status — current cache health for the TweaksPanel
 * indicator. fartola_dev is server-side-derived from process.env at
 * request time so the UI's admin-button gate is correct in production
 * builds (import.meta.env.DEV would be bundler-time and always false). */
export function getEventorStatus(): Promise<EventorStatusDTO> {
  return apiFetch<EventorStatusDTO>('/api/eventor/status');
}

// ---------------------------------------------------------------------------
// Eventor event-based import. Two-step:
//   1. listEventorEvents — show events on a given date so the operator
//      can confirm they're picking the right one (not just typing an ID)
//   2. importEntriesFromEventor — fetch + ingest the EntryList for the
//      chosen event ID
// ---------------------------------------------------------------------------

export interface EventorEventListItem {
  eventId: number;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM:SS — null for multi-day events. */
  clock: string | null;
}

/** GET /api/eventor/events/:id — fetch metadata for a single Eventor event.
 *
 * Used by the wizard Eventor quickstart to validate a typed event ID and
 * prefill name + date. Returns structured event metadata on success.
 * Throws ApiError on 400 (invalid id), 403 (forbidden), 404 (not found),
 * 502 (eventor down), 503 (no API key). */
export interface EventorEventMeta {
  eventId: number;
  name: string;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  /** Organising club/organisation name; may be null. */
  organisation: string | null;
}

export function getEventorEvent(eventId: number): Promise<EventorEventMeta> {
  return apiFetch<EventorEventMeta>(`/api/eventor/events/${encodeURIComponent(String(eventId))}`);
}

export function listEventorEvents(opts: {
  fromDate: string;
  toDate?: string;
  organisationIds?: string;
}): Promise<{ events: EventorEventListItem[] }> {
  const query: Record<string, string> = { fromDate: opts.fromDate };
  if (opts.toDate !== undefined) query['toDate'] = opts.toDate;
  if (opts.organisationIds !== undefined) query['organisationIds'] = opts.organisationIds;
  return apiFetch<{ events: EventorEventListItem[] }>('/api/eventor/events', { query });
}

export interface EventorImportResult {
  kind: 'EntryList';
  competitors_created: number;
  classes_missing: string[];
  /** Server count of duplicate-card skips. Surfaced separately from
   * competitors_created so the operator who re-clicks Importera sees
   * "X redan importerade" instead of a confusing bare "0 löpare". */
  competitors_skipped_duplicate: number;
  auto_bound: string[];
}

export function importEntriesFromEventor(
  competitionId: string,
  eventId: number
): Promise<EventorImportResult> {
  return apiFetch<EventorImportResult>(`/api/competitions/${competitionId}/eventor-import`, {
    method: 'POST',
    body: { eventId },
  });
}

// ---------------------------------------------------------------------------
// Settings — integration API keys (Phase 2.0 Plan 02-07).
// ---------------------------------------------------------------------------

export type IntegrationSource = 'env' | 'config' | 'absent';

export interface IntegrationStatus {
  key: string;
  set: boolean;
  source: IntegrationSource;
}

/** GET /api/settings/integrations — list every allowlisted integration
 * with its current { set, source } status. The `value` field is NEVER
 * returned by the API (write-only secret, OWASP A02:2021). The UI
 * masks the row to `••••••••` when set or shows the "Inte
 * konfigurerad" placeholder when set=false. */
export function listIntegrations(): Promise<{ integrations: IntegrationStatus[] }> {
  return apiFetch<{ integrations: IntegrationStatus[] }>('/api/settings/integrations');
}

/** PUT /api/settings/integrations — upsert the secret. Empty-string
 * value deletes the row (server treats both null and "" the same).
 * Server re-resolves env precedence on the response so the caller
 * knows whether the freshly-written config row will actually take
 * effect or if process.env still wins. */
export function setIntegration(
  key: string,
  value: string
): Promise<{ ok: true; key: string; set: boolean; source: IntegrationSource }> {
  return apiFetch('/api/settings/integrations', {
    method: 'PUT',
    body: { key, value },
  });
}

// ---------------------------------------------------------------------------
// Hired cards (Hyrbricka — Phase 2.0 Plan 02-05)
// ---------------------------------------------------------------------------

/** GET /api/competitions/:id/hired-cards — list open + returned rentals.
 * Backs the admin "Aktiva hyrbrickor" view; the Hyrbricka finish-readout
 * toast in ReadoutView reads hired_card_open from the /readout response
 * instead (single source of truth). */
export function listHiredCards(competitionId: string): Promise<HiredCardsListResponse> {
  return apiFetch<HiredCardsListResponse>(
    `/api/competitions/${encodeURIComponent(competitionId)}/hired-cards`
  );
}

/** PATCH /api/competitions/:id/hired-cards/:cardNumber/return — mark the
 * rental returned. Idempotent: the second call returns
 * `already_returned: true` with the original timestamp. */
export function returnHiredCard(
  competitionId: string,
  cardNumber: number
): Promise<HiredCardReturnResponse> {
  return apiFetch<HiredCardReturnResponse>(
    `/api/competitions/${encodeURIComponent(competitionId)}/hired-cards/${encodeURIComponent(
      String(cardNumber)
    )}/return`,
    { method: 'PATCH' }
  );
}

// ---------------------------------------------------------------------------
// Lottning — start-time draw (Phase 2.1 Plan 02.1-02 routes)
// ---------------------------------------------------------------------------

export interface LottningBody {
  mode: 'SOFT' | 'Random' | 'Simultaneous';
  firstStartMs: number;
  intervalSec: number;
  vacantSlots?: number;
}

export interface StartListEntry {
  id: string;
  name: string;
  club: string | null;
  card_number: number | null;
  start_time_ms: number | null;
}

export interface LottningResponse {
  class: {
    id: string;
    name: string;
    first_start_ms: number | null;
    start_interval_sec: number | null;
    max_time_sec: number | null;
  };
  start_list: StartListEntry[];
}

/** POST /api/competitions/:id/lottning/:classId — draw start times for a class.
 * Returns { drawn: N } where N is the number of competitors assigned times. */
export function postLottning(
  competitionId: string,
  classId: string,
  body: LottningBody
): Promise<{ drawn: number }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/lottning/${encodeURIComponent(classId)}`,
    { method: 'POST', body }
  );
}

/** GET /api/competitions/:id/lottning/:classId — fetch the current start list
 * for a class, sorted by start_time_ms ascending. */
export function getLottning(competitionId: string, classId: string): Promise<LottningResponse> {
  return apiFetch<LottningResponse>(
    `/api/competitions/${encodeURIComponent(competitionId)}/lottning/${encodeURIComponent(classId)}`
  );
}

/** PATCH /api/competitions/:id/classes/:classId — update class settings
 * (max_time_sec, etc.). Owned by Plan 02.1-02; this plan only consumes it. */
export function patchClass(
  competitionId: string,
  classId: string,
  body: { maxTimeSec?: number | null }
): Promise<{ ok: true }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/classes/${encodeURIComponent(classId)}`,
    { method: 'PATCH', body }
  );
}

/** PATCH /api/competitions/:id/competitors/:competitorId/start-time —
 * update a competitor's individual start_time_ms (D-07 per-runner edit).
 * Owned by Plan 02.1-02; this plan only consumes it. */
export function patchCompetitorStartTime(
  competitionId: string,
  competitorId: string,
  startTimeMs: number
): Promise<{ ok: true }> {
  return apiFetch(
    `/api/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(competitorId)}/start-time`,
    { method: 'PATCH', body: { start_time_ms: startTimeMs } }
  );
}

// ---------------------------------------------------------------------------
// Eventor push (Phase 2.1 Plan 02.1-08)
// ---------------------------------------------------------------------------

export function postEventorPushResults(competitionId: string): Promise<{ url: string }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/eventor/push-results`, {
    method: 'POST',
    body: {},
  });
}

export function postEventorPushStartlist(competitionId: string): Promise<{ url: string }> {
  return apiFetch(`/api/competitions/${encodeURIComponent(competitionId)}/eventor/push-startlist`, {
    method: 'POST',
    body: {},
  });
}

// ---------------------------------------------------------------------------
// Sessions (active competition pointer + bridge reconnect)
// ---------------------------------------------------------------------------

export function getActiveCompetition(): Promise<{ competition_id: string | null }> {
  return apiFetch('/api/sessions/active-competition');
}

export function setActiveCompetition(competitionId: string): Promise<{ competition_id: string }> {
  return apiFetch('/api/sessions/active-competition', {
    method: 'POST',
    body: { competition_id: competitionId },
  });
}

export function clearActiveCompetition(): Promise<void> {
  return apiFetch('/api/sessions/active-competition', { method: 'DELETE' });
}

export function reconnectBridge(): Promise<{ status: string }> {
  return apiFetch('/api/sessions/reconnect-bridge', { method: 'POST' });
}

export function getBridgeStatus(): Promise<{ state: 'opening' | 'open' | 'closed' | 'error' }> {
  return apiFetch('/api/bridge/status');
}

// ---------------------------------------------------------------------------
// Checkunit snapshot (Phase 2.1 Plan 02.1-06 — kvar-i-skogen)
// ---------------------------------------------------------------------------

export interface CheckunitSnapshotResult {
  /** SI card numbers read from the check-unit backup memory (started). */
  cardNumbers: number[];
  /** SI card numbers that have physically returned (card_read with finish
   * punch). NOT based on computed status — only physical finish reads. */
  returnedCardNumbers: number[];
  /** True when the check-unit's backup memory wrapped around (older records
   * may be missing). The UI warns the operator when this flag is set. */
  overflow: boolean;
  /** Total number of card numbers returned (convenience field). */
  readCount: number;
}

/** POST /api/competitions/:id/checkunit/snapshot
 * Reads the BSF8 check-unit backup memory via the active SI bridge reader.
 * Optional `reader` query param selects which reader to use when multiple are
 * connected (defaults to the first available reader). */
export function postCheckunitSnapshot(
  competitionId: string,
  opts: { reader?: string } = {}
): Promise<CheckunitSnapshotResult> {
  const query: Record<string, string> = {};
  if (opts.reader !== undefined) query['reader'] = opts.reader;
  return apiFetch<CheckunitSnapshotResult>(
    `/api/competitions/${encodeURIComponent(competitionId)}/checkunit/snapshot`,
    { method: 'POST', body: {}, ...(Object.keys(query).length > 0 ? { query } : {}) }
  );
}

// ---------------------------------------------------------------------------
// Dev — Simulate read (gated by FARTOLA_DEV=1 server-side)
// ---------------------------------------------------------------------------

export interface SimulateReadPayload {
  competition_id: string;
  card_number: number;
  card_type: string;
  punches: Array<{ control_code: number; time_ms: number | null }>;
}

export function devSimulateRead(payload: SimulateReadPayload): Promise<unknown> {
  return apiFetch('/api/__dev/simulate-read', { method: 'POST', body: payload });
}
