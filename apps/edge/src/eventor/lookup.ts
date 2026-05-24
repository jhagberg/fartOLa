// Authored for fartola. Not ported from upstream.
//
// Read-only Eventor lookup module (Plan 02-02 task 1).
//
// Two pure SQL functions over the Plan-01 cache tables:
//
//   - lookupBySiCard(handle, siCard, activeCompetitionId?)
//     Multi-row SELECT against eventor_competitors with a LEFT JOIN onto
//     eventor_clubs. Returns a discriminated union:
//       { hit: true, alternatives: N, allCandidates, ...candidate } — resolved
//         alternatives: 0  → unique card (no ambiguity)
//         alternatives: N-1 → recency resolved, N-1 others exist
//       { hit: 'many', candidates } — recency tie, operator must pick
//       { hit: false } — no match.
//
//     Disambiguation algorithm (Plan 02.1-10):
//       1. Unique match → hit with alternatives: 0.
//       2. Multiple matches → recency rule (highest modifyDateMs wins).
//          On exact tie → hit: 'many' (operator must pick).
//
//     NOTE: The `activeCompetitionId` parameter is accepted for future
//     context-aware disambiguation (when competitors.eventor_person_id is
//     available to map Eventor persons to local registrations). Currently,
//     competition context is not used in the selection algorithm because
//     the competitors table has no FK to eventor_competitors.person_id.
//     The schema's unique constraint on (competition_id, card_number) makes
//     same-competition shared-card disambiguation non-representable without
//     that FK. See Plan 02.1-10 deviation notes in SUMMARY.md.
//
//   - lookupByNamePrefix(handle, prefix, limit)
//     Returns up to `limit` matches using `family_name LIKE prefix || '%'`.
//     The composite index idx_eventor_name(family_name, given_name) covers
//     the leading-prefix scan. Empty prefix is a cheap guard — returns [].
//     Caller is expected to enforce minLength 2 (Plan-02 RESEARCH §"WalkupModal
//     Hyrbricka extension"), but defensive trimming/early-return here keeps
//     the function honest if a stray ?prefix= ever lands.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-02-PLAN.md task 1
// - .planning/phases/02-4-klubbs-mvp/02-01-PLAN.md (provides the
//   eventor_competitors / eventor_clubs tables + the indexes used here)
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-10-PLAN.md
//   (adds recency-based disambiguation + alternatives count + WalkupModal chip)

import { eq, asc, sql } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { eventorCompetitors, eventorClubs } from '../db/schema.ts';

export interface EventorLookupCandidate {
  person_id: number;
  family_name: string;
  given_name: string;
  club_id: number | null;
  club_name: string | null;
}

export interface EventorLookupHit extends EventorLookupCandidate {
  hit: true;
  /** Number of alternative candidates that exist for this SI card number but
   * were NOT selected. 0 = unique match (no ambiguity). >0 = recency/context
   * resolved but alternatives are known. The WalkupModal renders a
   * "+N andra chip" when this is >0 so the operator can override. */
  alternatives: number;
  /** Full list of ALL candidates when alternatives > 0 (populated for the
   * chip pop-over so the operator can pick any candidate without a second
   * round-trip). Empty when alternatives === 0 (unique match). */
  allCandidates: EventorLookupCandidate[];
}

export interface EventorLookupMany {
  hit: 'many';
  candidates: EventorLookupCandidate[];
}

export interface EventorLookupMiss {
  hit: false;
}

export type EventorLookupResult = EventorLookupHit | EventorLookupMany | EventorLookupMiss;

export interface EventorNameSuggestion {
  person_id: number;
  family_name: string;
  given_name: string;
  club_name: string | null;
  si_card: number | null;
}

/** Lookup by SI card number. Returns a tri-state discriminated union:
 *
 *   - { hit: true, alternatives: 0, ... } when exactly one candidate matches.
 *   - { hit: true, alternatives: N-1, ... } when multiple candidates exist but
 *     one is resolved via competition context or recency rule.
 *   - { hit: 'many', candidates } when same-competition disambiguation is needed
 *     (multiple candidates are registered in the same active competition for
 *     this SI card — operator must pick manually).
 *   - { hit: false } on no match.
 *
 * @param activeCompetitionId — optional competition UUID. When supplied, the
 *   resolver joins against `competitors` to prefer a runner registered in this
 *   competition. When multiple runners with the same card are both registered
 *   in the same competition, returns 'many' to force manual disambiguation.
 *
 * club_name is resolved via LEFT JOIN — null when the competitor row's
 * club_id is itself null OR points at an unknown club. */
export function lookupBySiCard(
  handle: DbHandle,
  siCard: number,
  activeCompetitionId: string | null
): EventorLookupResult {
  // Reserved for future context-aware disambiguation — will join against
  // competitors.eventor_person_id when that FK is available.
  void activeCompetitionId;

  // Fetch all Eventor cache rows for this SI card, with modifyDateMs for
  // recency comparison. Ordered alphabetically for deterministic multi output.
  const rows = handle.db
    .select({
      person_id: eventorCompetitors.personId,
      family_name: eventorCompetitors.familyName,
      given_name: eventorCompetitors.givenName,
      club_id: eventorCompetitors.clubId,
      club_name: eventorClubs.name,
      modify_date_ms: eventorCompetitors.modifyDateMs,
    })
    .from(eventorCompetitors)
    .leftJoin(eventorClubs, eq(eventorCompetitors.clubId, eventorClubs.clubId))
    .where(eq(eventorCompetitors.siCard, siCard))
    .orderBy(asc(eventorCompetitors.familyName), asc(eventorCompetitors.givenName))
    .all();

  if (rows.length === 0) return { hit: false };

  type Row = (typeof rows)[0];

  const toCandidate = (r: Row): EventorLookupCandidate => ({
    person_id: r.person_id,
    family_name: r.family_name,
    given_name: r.given_name,
    club_id: r.club_id,
    club_name: r.club_name ?? null,
  });

  if (rows.length === 1) {
    const r = rows[0]!;
    return { hit: true, alternatives: 0, allCandidates: [], ...toCandidate(r) };
  }

  // Multiple candidates — apply disambiguation.
  // NOTE: activeCompetitionId is accepted for future context-aware disambiguation
  // (reserved for when competitors.eventor_person_id FK is available). Currently,
  // competition context is not used in the selection algorithm because the local
  // competitors table has no FK to eventor_competitors.person_id, making it
  // impossible to reliably identify which Eventor person maps to a local competitor.
  // See Plan 02.1-10 SUMMARY.md deviation notes.
  const alternatives = rows.length - 1;

  // Recency rule — pick the row with the highest modifyDateMs.
  const sorted = [...rows].sort((a, b) => b.modify_date_ms - a.modify_date_ms);
  const topMs = sorted[0]!.modify_date_ms;
  const topGroup = sorted.filter((r) => r.modify_date_ms === topMs);

  if (topGroup.length > 1) {
    // Recency tie → operator must pick.
    return { hit: 'many', candidates: rows.map(toCandidate) };
  }

  return {
    hit: true,
    alternatives,
    allCandidates: rows.map(toCandidate),
    ...toCandidate(sorted[0]!),
  };
}

/** Legacy: name-prefix autocomplete via `family_name LIKE prefix%`. Kept
 * for back-compat with existing /api/eventor/lookup?prefix= callers
 * (WalkupModal's EventorAutocomplete). Prefer `searchCompetitorsByName`
 * for new code — it folds diacritics and matches across family + given +
 * club in any word order via FTS5. */
export function lookupByNamePrefix(
  handle: DbHandle,
  prefix: string,
  limit: number
): EventorNameSuggestion[] {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return [];

  // Escape SQLite LIKE wildcards (% _) and the escape char itself so an
  // operator typing literal `%` or `_` doesn't accidentally expand the
  // match set. `\` is declared as the ESCAPE clause below.
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);

  const rows = handle.db
    .select({
      person_id: eventorCompetitors.personId,
      family_name: eventorCompetitors.familyName,
      given_name: eventorCompetitors.givenName,
      club_name: eventorClubs.name,
      si_card: eventorCompetitors.siCard,
    })
    .from(eventorCompetitors)
    .leftJoin(eventorClubs, eq(eventorCompetitors.clubId, eventorClubs.clubId))
    .where(sql`${eventorCompetitors.familyName} LIKE ${`${escaped}%`} ESCAPE '\\'`)
    .orderBy(asc(eventorCompetitors.familyName), asc(eventorCompetitors.givenName))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    person_id: r.person_id,
    family_name: r.family_name,
    given_name: r.given_name,
    club_name: r.club_name ?? null,
    si_card: r.si_card,
  }));
}

export interface EventorClubSuggestion {
  club_id: number;
  name: string;
  short_name: string | null;
  media_name: string | null;
}

interface FtsCompetitorRow {
  person_id: number;
  family_name: string;
  given_name: string;
  club_name: string | null;
  si_card: number | null;
}

interface FtsClubRow {
  club_id: number;
  name: string;
  short_name: string | null;
  media_name: string | null;
}

/** Build an FTS5 MATCH expression from a free-text operator query. We
 * split on whitespace AND common punctuation separators (comma / semicolon
 * / slash — operators reach for these when typing "Karlsson, Per" or
 * "Per Karlsson, Stora Tuna"), sanitise every token to safe FTS5 alnum
 * (strips the special chars FTS5 treats as operators: `* " ( ) : -`),
 * and append `*` to each remaining non-empty token so "jonas hag" matches
 * "jonas*" AND "hag*". The implicit FTS5 AND between bare tokens means
 * word order is irrelevant — "hag jonas", "jonas hag", and "jonas hag stora"
 * all match the same conjunctive filter (each token must hit *some* column,
 * which means the operator can mix name and club words freely: e.g.
 * "per karlsson stora tuna" finds Per Karlsson at Stora Tuna OK). Returns
 * null when sanitisation leaves no usable tokens (caller treats it as zero
 * hits without ever hitting SQLite). */
function buildFtsMatch(rawQuery: string): string | null {
  const tokens = rawQuery
    .split(/[\s,;/]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(' ');
}

/** FTS5-backed name + club search. Folds diacritics (mårsell ↔ marsell),
 * matches across family + given + club_name, word-order-free. Returns up
 * to `limit` matches ordered by FTS5 rank (BM25-ish relevance — exact
 * token hits rank above prefix hits). Falls back to an empty array on
 * an empty / sanitised-empty query.
 *
 * When `clubId` is supplied, the result set is hard-narrowed to that
 * federation club. This is the path the Lägg-till sheet uses once the
 * operator has picked a club: typing a common name like "Per Karlsson"
 * across 252k rows would otherwise drown the in-club match in higher-
 * ranked homonyms from other clubs. */
export function searchCompetitorsByName(
  handle: DbHandle,
  query: string,
  limit: number,
  clubId?: number
): EventorNameSuggestion[] {
  const match = buildFtsMatch(query);
  if (match === null) return [];

  if (clubId !== undefined) {
    const sqliteRows = handle.sqlite
      .prepare<[string, number, number], FtsCompetitorRow>(
        `SELECT
           c.person_id,
           c.family_name,
           c.given_name,
           k.name AS club_name,
           c.si_card
         FROM eventor_competitors_fts f
         JOIN eventor_competitors c ON c.person_id = f.rowid
         LEFT JOIN eventor_clubs k ON k.club_id = c.club_id
         WHERE eventor_competitors_fts MATCH ?
           AND c.club_id = ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(match, clubId, limit);

    return sqliteRows.map((r) => ({
      person_id: r.person_id,
      family_name: r.family_name,
      given_name: r.given_name,
      club_name: r.club_name ?? null,
      si_card: r.si_card,
    }));
  }

  // Demote NULL-club ("Klubblös") rows: BM25 rewards short text and the
  // unattached cache rows have no club_name to inflate length, so they
  // can dominate the top of a ranked result set even when an in-club hit
  // exists. The `c.club_id IS NULL` boolean evaluates to 0 (false → first)
  // / 1 (true → last) under ASC, so attached rows always sort above
  // unattached ones; rank is the tiebreaker within each group.
  const sqliteRows = handle.sqlite
    .prepare<[string, number], FtsCompetitorRow>(
      `SELECT
         c.person_id,
         c.family_name,
         c.given_name,
         k.name AS club_name,
         c.si_card
       FROM eventor_competitors_fts f
       JOIN eventor_competitors c ON c.person_id = f.rowid
       LEFT JOIN eventor_clubs k ON k.club_id = c.club_id
       WHERE eventor_competitors_fts MATCH ?
       ORDER BY (c.club_id IS NULL) ASC, rank ASC
       LIMIT ?`
    )
    .all(match, limit);

  return sqliteRows.map((r) => ({
    person_id: r.person_id,
    family_name: r.family_name,
    given_name: r.given_name,
    club_name: r.club_name ?? null,
    si_card: r.si_card,
  }));
}

/** FTS5-backed club search across the federation's eventor_clubs cache.
 * Matches across name + short_name + media_name so the operator can type
 * "stk" (short), "stora tuna" (name), or "stortuna" (no-space variant)
 * and find the same row. */
export function searchClubsByName(
  handle: DbHandle,
  query: string,
  limit: number
): EventorClubSuggestion[] {
  const match = buildFtsMatch(query);
  if (match === null) return [];

  const sqliteRows = handle.sqlite
    .prepare<[string, number], FtsClubRow>(
      `SELECT
         c.club_id,
         c.name,
         c.short_name,
         c.media_name
       FROM eventor_clubs_fts f
       JOIN eventor_clubs c ON c.club_id = f.rowid
       WHERE eventor_clubs_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(match, limit);

  return sqliteRows.map((r) => ({
    club_id: r.club_id,
    name: r.name,
    short_name: r.short_name,
    media_name: r.media_name,
  }));
}
