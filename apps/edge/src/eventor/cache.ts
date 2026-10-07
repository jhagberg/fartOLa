// Authored for fartola. Not ported from upstream.
//
// Eventor cache ingester (Plan 02-01 task 3).
//
//   ingestEventorCache(handle, competitorsXmlPath, clubsXmlPath, nowMs)
//     → { competitors: N, clubs: M }
//
// One transactional snapshot replace per call:
//   1. Stream competitors via parser.streamCompetitorsXml into an in-memory
//      buffer. ~252 919 records × ~100 bytes / record peaks at ~25–50 MB
//      heap — well inside what the bench laptop has. The simpler error
//      handling is worth the headroom (RESEARCH §Pattern 2 endorses this
//      buffer-then-flush variant over the stream-into-transaction one).
//   2. Parse clubs via parser.parseClubsXmlSync — DOM is fine at 1.3 MB.
//   3. Open a single handle.sqlite.transaction(() => { ... })() and inside:
//        a. DELETE FROM eventor_competitors + DELETE FROM eventor_clubs
//           (TRUNCATE+INSERT semantics — same model as MOP D-MOP-2).
//        b. Bulk-insert clubs FIRST (FK target for competitors.club_id).
//        c. Bulk-insert competitors in 1000-row batches via Drizzle's
//           .insert(table).values(chunk).run() (a single SQL INSERT with
//           N value tuples — fast).
//        d. UPSERT config row `eventor_cache_refreshed_at_ms = String(nowMs)`.
//      If ANY step throws (parser error before the transaction, FK
//      violation inside, batch insert failure), better-sqlite3 rolls back
//      the entire transaction — the prior snapshot AND the prior config
//      marker survive untouched.
//
// FK note: eventor_competitors.club_id references eventor_clubs.club_id
// with NO cascade. To keep the snapshot replace atomic, clubs are inserted
// before competitors. Foreign key checks are enforced by the WAL pragma
// `foreign_keys = ON` set in db/index.ts.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-01-PLAN.md task 3
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §Pattern 2 (verbatim
//   ingestEventorCache template)
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-EV-2 (7-day staleness
//   gate reads the config marker this function writes)
// - docs/decisions/0009-eventor-runner-cache.md (PII trade-off)

import { sql } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { eventorCompetitors, eventorClubs, config as configTable } from '../db/schema.ts';
import {
  streamCompetitorsXml,
  parseClubsXmlSync,
  type EventorCompetitor,
  type EventorClub,
} from './parser.ts';

export interface EventorIngestResult {
  competitors: number;
  clubs: number;
  /** Phase 2.0 — count of competitors whose Eventor-supplied club_id
   * referenced a club NOT present in the just-loaded clubs.xml. These
   * rows are still ingested (the runner stays searchable by si_card and
   * by family_name) but with `club_id = NULL`, so club autocomplete
   * misses them. A jump in this counter is a canary for a clubs.xml
   * regression (e.g. Eventor temporarily omits an org during a server
   * update); the boot.ts handler logs it at warn level so the 4-klubbs
   * operator sees `Eventor: N runners nulled (orphan club)` next to the
   * cache-age indicator. Code-review F-005 fix. */
  nulledClubs: number;
}

const BATCH_SIZE = 1000;
const CONFIG_MARKER_KEY = 'eventor_cache_refreshed_at_ms';

export async function ingestEventorCache(
  handle: DbHandle,
  competitorsXmlPath: string,
  clubsXmlPath: string,
  nowMs: number
): Promise<EventorIngestResult> {
  // Phase A — stream + parse OUTSIDE the transaction. Any error here aborts
  // ingest BEFORE we touch the DB, so the prior snapshot is intact by
  // construction (no rollback needed).
  const allRecords: EventorCompetitor[] = [];
  await streamCompetitorsXml(competitorsXmlPath, (rec) => {
    allRecords.push(rec);
  });
  const allClubs: EventorClub[] = parseClubsXmlSync(clubsXmlPath);

  // Phase B — synchronous transactional snapshot replace. better-sqlite3
  // transactions are synchronous; the wrapper rolls back on throw.
  let competitorsInserted = 0;
  let clubsInserted = 0;
  let nulledClubs = 0;
  handle.sqlite.transaction(() => {
    // 1. Wipe prior snapshot. FK order matters — competitors.club_id
    //    references eventor_clubs.club_id; delete competitors first.
    handle.db.run(sql`DELETE FROM eventor_competitors`);
    handle.db.run(sql`DELETE FROM eventor_clubs`);

    // 2. Bulk-insert clubs (FK target for competitors).
    if (allClubs.length > 0) {
      // Even clubs go through batched inserts; 1000-row chunks keep the
      // SQL statement size manageable.
      for (let i = 0; i < allClubs.length; i += BATCH_SIZE) {
        const chunk = allClubs.slice(i, i + BATCH_SIZE).map((c) => ({
          clubId: c.club_id,
          name: c.name,
          shortName: c.short_name,
          mediaName: c.media_name,
          parentId: c.parent_id,
          modifyDateMs: c.modify_date_ms,
        }));
        // onConflictDoNothing — survive duplicate club_id rows in the
        // upstream feed without rolling back the whole snapshot.
        handle.db.insert(eventorClubs).values(chunk).onConflictDoNothing().run();
        clubsInserted += chunk.length;
      }
    }

    // 3. Bulk-insert competitors. Map snake_case parser shape to camelCase
    //    Drizzle field names *inside* the batch slice so we never hold a
    //    second ~250k-row array alongside `allRecords`. FK-safety: null the
    //    club_id rather than fail the transaction when the competitor
    //    references a club we don't have in the just-loaded set (orphan
    //    rows are common — see fixture row 1002). Count nullings for
    //    observability (code-review F-005) — boot.ts surfaces this.
    const knownClubIds = new Set(allClubs.map((c) => c.club_id));
    for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
      const chunk = allRecords.slice(i, i + BATCH_SIZE).map((r) => {
        const hasClubMatch = r.club_id !== null && knownClubIds.has(r.club_id);
        if (r.club_id !== null && !hasClubMatch) nulledClubs++;
        return {
          personId: r.person_id,
          familyName: r.family_name,
          givenName: r.given_name,
          birthYear: r.birth_year,
          sex: r.sex,
          clubId: hasClubMatch ? r.club_id : null,
          siCard: r.si_card,
          emitCard: r.emit_card,
          modifyDateMs: r.modify_date_ms,
        };
      });
      // onConflictDoNothing — same defense as the clubs insert. A duplicate
      // person_id in cachedcompetitors.xml shouldn't tank the snapshot.
      handle.db.insert(eventorCompetitors).values(chunk).onConflictDoNothing().run();
      competitorsInserted += chunk.length;
    }

    // 4. Audit marker — boot.ts reads this to decide if cache is > 7 days
    //    old. Upsert inside the SAME transaction so a partial-flush failure
    //    leaves both the data AND the marker at their prior state.
    handle.db
      .insert(configTable)
      .values({ key: CONFIG_MARKER_KEY, value: String(nowMs) })
      .onConflictDoUpdate({ target: configTable.key, set: { value: String(nowMs) } })
      .run();
  })();

  return { competitors: competitorsInserted, clubs: clubsInserted, nulledClubs };
}
