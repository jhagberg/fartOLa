// Authored for fartola. Not ported from upstream.
//
// Pure ingester: writes a ParsedEntryList document into the SQLite layer
// inside a transaction. Used by both /api/competitions/:id/import (existing
// competition, ingester wraps its own transaction) and the C-H3 atomic
// /api/competitions/from-wizard endpoint (caller owns the outer transaction
// via opts.outerTransaction=true).
//
// C-M4 EntryList consent semantics (LOCKED here):
//   - Every imported competitor row gets consent_at_ms = NULL AND
//     consent_status = 'pending_first_read'.
//   - Plan 14 surfaces a one-time "Bekräfta samtycke" toast on the first
//     card_read for a pending_first_read competitor; the operator's
//     confirmation flips consent_status → 'confirmed_on_read' AND sets
//     consent_at_ms = Date.now() via an UPDATE in plan 14.
//   - Walk-up registration (plan 04) uses the schema DEFAULT 'explicit' +
//     Date.now() consent_at_ms; plan 04 never calls this function.
//
// Partial-import behavior: if an EntryList Person references a class name
// that does NOT exist in the competition's classes table, that competitor
// is SKIPPED and the class name added to result.classes_missing. This
// matches the wizard's "CourseData first, EntryList second" precondition —
// the wizard surfaces classes_missing as a warning toast instead of failing
// the whole import. (For the from-wizard atomic endpoint, classes_missing
// being non-empty when ALL competitors fall through means we throw inside
// doIngest so the transaction rolls back — see the "entrylist_without_
// courses" path.)
//
// Duplicate card_number: if a competitor with the same card_number already
// exists in the competition, the new row is skipped. The
// D-11 partial unique index would otherwise abort the whole transaction
// with a constraint error; the pre-flight SELECT keeps the failure mode
// graceful for the bulk-import path.
//
// 02.1-14 Task 6: no silent drops — every skipped row is returned in
// `skipped` with its 1-based PersonEntry position and the reason.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-M4
//   (EntryList consent semantics — pending_first_read + null)

import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';

import type { DbHandle } from '../db/index.ts';
import { classes, clubs, competitors } from '../db/schema.ts';
import type { ParsedEntryList } from '../xml/parse.ts';

/** One import row that was not applied (02.1-14 Task 6). `row` is the 1-based
 * position of the PersonEntry / PersonStart in the file. `no_start_time` is
 * StartList-only: the row had no StartTime to apply. */
export interface SkippedImportRow {
  row: number;
  name: string;
  class: string;
  card: number | null;
  /** duplicate_runner: StartList only — two imported rows matched one runner. */
  reason: 'unknown_class' | 'duplicate_card' | 'duplicate_runner' | 'no_match' | 'no_start_time';
}

export interface EntryImportResult {
  competitors_created: number;
  /** Class names referenced by PersonEntry that did not match any class in
   * the competition's classes table. Non-empty = some entries were
   * skipped; the wizard surfaces this as a warning. */
  classes_missing: string[];
  /** Count of entries silently skipped because a competitor with the same
   * card_number already exists in the competition (D-11 dedupe). The
   * eventor-import UI surfaces this so an operator who re-clicks
   * Importera sees "X redan importerade" instead of a bare "0 löpare
   * importerade" that looks like Eventor returned nothing. */
  competitors_skipped_duplicate: number;
  /** Entries skipped because their class does not exist in the competition. */
  competitors_skipped_unknown_class: number;
  /** Every skipped entry, in file order. */
  skipped: SkippedImportRow[];
}

export interface EntryImportOpts {
  outerTransaction?: boolean;
}

function doIngest(
  handle: DbHandle,
  competitionId: string,
  data: ParsedEntryList,
  nowMs: number
): EntryImportResult {
  // Pre-load classes for this competition into a Map<name, id> so we don't
  // hit the DB once per competitor.
  const classIdByName = new Map<string, string>();
  const existingClasses = handle.db
    .select({ id: classes.id, name: classes.name })
    .from(classes)
    .where(sql`${classes.competitionId} = ${competitionId}`)
    .all();
  for (const row of existingClasses) {
    classIdByName.set(row.name, row.id);
  }

  const missing = new Set<string>();
  let competitorsCreated = 0;
  let competitorsSkippedDuplicate = 0;
  const skipped: SkippedImportRow[] = [];
  // Bulk-upsert distinct club names ONCE after the competitor loop instead
  // of per-row inside it (PR #3 review — Gemini medium). For an EntryList
  // with N competitors sharing K distinct clubs, this drops to K writes
  // worst-case versus N writes per import. Save is small at Phase 1 / 2
  // scale (~100ms at most) but the cost is also small (~3 lines) so worth
  // it for clarity.
  //
  // Add to the Set only on the SUCCESSFUL insert path (Codex round-2
  // WR-001). Before this guard, rows that the loop skipped (duplicate
  // card or missing class) still leaked their club into the clubs table
  // — small data-retention drift between the accepted competitor set and
  // the autocomplete table.
  const distinctClubs = new Set<string>();
  // 02.1-14 Task 9: classes the EntryList marks resultListMode=
  // "UnorderedNoTimes". Only turned on, never off (as MeOS readClass).
  const noTimingClassIds = new Set<string>();

  for (const [i, e] of data.competitors.entries()) {
    const skip = (reason: SkippedImportRow['reason']): void => {
      skipped.push({
        row: e.row ?? i + 1,
        name: e.name,
        class: e.class_name,
        card: e.card_number,
        reason,
      });
    };
    const classId = classIdByName.get(e.class_name);
    if (!classId) {
      if (e.class_name.length > 0) missing.add(e.class_name);
      skip('unknown_class');
      continue;
    }
    if (e.class_no_timing === true) noTimingClassIds.add(classId);
    // D-11 pre-flight duplicate-card check (reported skip on duplicate).
    if (e.card_number !== null) {
      const dup = handle.db
        .select({ id: competitors.id })
        .from(competitors)
        .where(
          sql`${competitors.competitionId} = ${competitionId} AND ${competitors.cardNumber} = ${e.card_number}`
        )
        .get();
      if (dup) {
        competitorsSkippedDuplicate++;
        skip('duplicate_card');
        continue;
      }
    }
    // C-M4: EntryList-imported competitors start at pending_first_read +
    // NULL consent_at_ms. Plan 14 flips the status on first card_read.
    handle.db
      .insert(competitors)
      .values({
        id: crypto.randomUUID(),
        competitionId,
        name: e.name,
        club: e.club,
        classId,
        cardNumber: e.card_number,
        consentAtMs: null,
        consentStatus: 'pending_first_read',
        scrubbedAtMs: null,
      })
      .run();
    competitorsCreated++;
    if (e.club !== null && e.club.length > 0) distinctClubs.add(e.club);
  }
  for (const id of noTimingClassIds) {
    handle.db.update(classes).set({ noTiming: true }).where(eq(classes.id, id)).run();
  }
  for (const clubName of distinctClubs) {
    handle.db
      .insert(clubs)
      .values({ name: clubName, lastSeenAtMs: nowMs })
      .onConflictDoUpdate({ target: clubs.name, set: { lastSeenAtMs: nowMs } })
      .run();
  }

  // If EVERY competitor in the EntryList was rejected because its class
  // name didn't match any class in the competition, surface as a hard
  // error so the from-wizard atomic transaction rolls back the competition
  // row. This is the "entrylist_without_courses" precondition the plan
  // calls out: the wizard normally uploads CourseData first. Distinguish
  // from the duplicate-card-skip path (where competitors_created is 0 but
  // classes_missing is empty) — that's a legitimate idempotent no-op.
  if (competitorsCreated === 0 && missing.size > 0) {
    throw new Error(
      `EntryList references ${missing.size} class name(s) but no matching classes exist in the competition; ` +
        `upload CourseData first. Missing: ${[...missing].join(', ')}`
    );
  }

  return {
    competitors_created: competitorsCreated,
    classes_missing: [...missing],
    competitors_skipped_duplicate: competitorsSkippedDuplicate,
    competitors_skipped_unknown_class: skipped.length - competitorsSkippedDuplicate,
    skipped,
  };
}

export function ingestEntryList(
  handle: DbHandle,
  competitionId: string,
  data: ParsedEntryList,
  nowMs: number,
  opts: EntryImportOpts = {}
): EntryImportResult {
  if (opts.outerTransaction) return doIngest(handle, competitionId, data, nowMs);
  let result: EntryImportResult = {
    competitors_created: 0,
    classes_missing: [],
    competitors_skipped_duplicate: 0,
    competitors_skipped_unknown_class: 0,
    skipped: [],
  };
  handle.sqlite.transaction(() => {
    result = doIngest(handle, competitionId, data, nowMs);
  })();
  return result;
}
