// Authored for fartola. Not ported from upstream.
//
// POST /api/competitions/:id/import — multipart XML upload that dispatches
// on the XML root element to either ingestCourseData or ingestEntryList.
// The endpoint validates the bytes against the bundled IOF.xsd BEFORE any
// DB write (RESEARCH §Pattern 7 — XSD validation gates every ingest).
//
// Also adds:
//   POST /api/competitions/:id/import/startlist — StartList XML upload that
//     matches entries to local competitors by SI card or name+class, then
//     writes start_time_ms for exact matches in a transaction. Fuzzy name-
//     only matches are returned as pending_confirmation for operator review.
//     02.1-14 Task 6: a card that does not match but name + club does is a
//     changed/rented card — matched, card_number updated, reported in
//     cardUpdates; every other unapplied row is listed in `skipped`.
//
//   POST /api/competitions/:id/import/startlist/confirm — Idempotent endpoint
//     that applies operator-confirmed fuzzy matches. Re-confirming an already-
//     applied match returns { applied: 0, alreadyApplied: 1 } without
//     duplicate writes (DeepSeek HIGH idempotency fix).
//
// Behavior contract for the original import endpoint:
//   1. Read the multipart `file` part (single file, 5 MB cap — Fastify's
//      multipart fileSize limit returns 413 automatically).
//   2. Sanitize the filename: '..' or absolute paths → 400 'bad_filename'
//      (T-PATH-TRAVERSAL — the filename is metadata only, never written
//      to disk, but we reject anyway to keep the audit log clean).
//   3. parseIofXml(bytes.toString('utf8')) — DOCTYPE/ENTITY pre-flight +
//      root dispatch. Errors → 400 'parse_failed'.
//   4. validateXml(xmlSource) — XSD gate. Errors → 400 'xsd_invalid' with
//      a structured errors[] (line + message).
//   5. Verify the competition exists → 404 if not.
//   6. Dispatch:
//        - CourseData → ingestCourseData (its own sqlite.transaction).
//        - EntryList  → ingestEntryList  (its own sqlite.transaction).
//   7. 201 with the kind + ingest result counts.
//
// This endpoint is for the "I already have a competition; import data into
// it" path (e.g. uploading an EntryList AFTER the wizard's CourseData
// already went through /api/competitions/from-wizard). The wizard's
// initial CourseData upload uses the atomic /from-wizard endpoint instead
// (C-H3 — see ./competitionsFromWizard.ts) so the competition INSERT and
// the ingest commit/rollback as one unit.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-03 D-15
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §"File
//   import flow" + §"Error states" (Filen kunde inte läsas copy contract)
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H3
//   (this route does NOT create the competition — the atomic-wizard route
//   does; this route assumes the competition row already exists)
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-03-PLAN.md task 2

import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { isAbsolute } from 'node:path';
import multipart from '@fastify/multipart';
import { z } from 'zod';

import {
  competitions,
  competitors as competitorsTable,
  classes as classesTable,
} from '../db/schema.ts';
import { parseIofXml } from '../xml/parse.ts';
import { validateXml } from '../xml/validate.ts';
import { matchPreviousStage } from '../draw/previousStage.ts';
import { importResultList, importStartList } from '../xml/iofImport.ts';
import { competitionClockOffsetMin } from '../time/competitionClock.ts';
import { writeStartTimes } from '../db/startTimes.ts';
import { ingestCourseData } from '../ingest/courseImport.ts';
import { ingestEntryList, type SkippedImportRow } from '../ingest/entryImport.ts';
import { autoBindNewCompetitors } from '../projection/auto-bind.ts';
import { StartTimeMs } from './competitors.ts';
import { issuesToErrors } from './_zod-errors.ts';

// ---------------------------------------------------------------------------
// StartList matching helpers (plan 02.1-03).
// ---------------------------------------------------------------------------

/** A competitor row from the DB — minimal fields for matching. */
interface CompetitorRow {
  id: string;
  name: string;
  club: string | null;
  classId: string;
  cardNumber: number | null;
  startTimeMs: number | null;
}

/** A local class row. */
interface ClassRow {
  id: string;
  name: string;
}

/** Normalized name for fuzzy comparison — lowercase, trim, collapse spaces. */
function normalizeName(n: string): string {
  return n.toLowerCase().trim().replace(/\s+/g, ' ');
}

export interface FuzzyMatch {
  /** The imported entry from the XML. */
  imported: {
    name: string;
    className: string;
    startTimeMs: number;
    siCard: number | null;
    bibNumber: string | null;
  };
  /** The local competitor candidate. */
  candidate: {
    id: string;
    name: string;
    classId: string;
  };
  /** Simple confidence indicator. */
  confidence: 'name_class';
}

/** 02.1-14 Task 6: a runner matched by name + club whose card changed. */
export interface CardUpdate {
  row: number;
  competitor_id: string;
  name: string;
  class: string;
  previous_card: number | null;
  card: number;
}

export interface StartListMatchResult {
  exact: number;
  fuzzy: number;
  /** Rows not applied; equals skipped.length. */
  unmatched: number;
  card_updated: number;
  fuzzyMatches: FuzzyMatch[];
  cardUpdates: CardUpdate[];
  skipped: SkippedImportRow[];
}

/** POST …/import/startlist/confirm body: operator-confirmed fuzzy matches. */
const ConfirmBody = z.object({
  matches: z.array(
    z.object({ competitorId: z.string().min(1), startTimeMs: StartTimeMs.unwrap() })
  ),
});

export default async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  // 5 MB body cap, single file per request. T-LARGE-BODY-DOS mitigation.
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/import/startlist
  //
  // Multipart XML upload for an IOF XML 3.0 StartList document. Matches
  // entries to local competitors and writes start_time_ms for exact matches
  // (by SI card). Fuzzy name+class matches are returned as pending_confirmation.
  //
  // T-02.1-06: DOCTYPE/ENTITY pre-flight via importStartList's XMLParser
  // config (processEntities: false). Body size capped by multipart plugin.
  //
  // Response:
  //   201 { exact: N, fuzzy: M, unmatched: K, fuzzyMatches: [...] }
  //   400 { error: 'no_file' | 'bad_filename' | 'parse_failed' | 'bad_upload' }
  //   404 { error: 'competition_not_found' }
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/import/startlist',
    async (req, reply) => {
      const competitionId = req.params.id;

      const comp = app.fartolaDb.db
        .select({
          id: competitions.id,
          date: competitions.date,
          clockOffsetMin: competitions.clockOffsetMin,
        })
        .from(competitions)
        .where(eq(competitions.id, competitionId))
        .get();
      if (!comp) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      const part = await req.file();
      if (!part) {
        return reply.code(400).send({ error: 'no_file', message: 'Förväntar en fil.' });
      }
      const filename = part.filename;
      if (filename.includes('..') || isAbsolute(filename)) {
        return reply.code(400).send({ error: 'bad_filename' });
      }

      let bytes: Buffer;
      try {
        bytes = await part.toBuffer();
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(msg)) {
          return reply.code(413).send({ error: 'file_too_large' });
        }
        return reply.code(400).send({ error: 'bad_upload', detail: msg });
      }
      const xmlSource = bytes.toString('utf8');

      // T-FILE-IMPORT pre-flight — importStartList's parser has processEntities:false
      // but we also do the pre-flight here for defense-in-depth (same as parse.ts).
      if (/<!DOCTYPE/i.test(xmlSource)) {
        return reply.code(400).send({ error: 'parse_failed', detail: 'DOCTYPE not allowed' });
      }
      if (/<!ENTITY/i.test(xmlSource)) {
        return reply
          .code(400)
          .send({ error: 'parse_failed', detail: 'ENTITY declarations not allowed' });
      }

      const validation = await validateXml(xmlSource);
      if (!validation.valid) {
        return reply.code(400).send({
          error: 'xsd_invalid',
          message: 'StartList XML klarade inte XSD-validering.',
          errors: validation.errors.slice(0, 10),
        });
      }

      let entries;
      try {
        entries = importStartList(
          xmlSource,
          competitionClockOffsetMin(comp.date, comp.clockOffsetMin)
        );
      } catch (e) {
        return reply.code(400).send({
          error: 'parse_failed',
          message: 'Filen kunde inte läsas — förväntar IOF XML 3.0 StartList.',
          detail: (e as Error).message,
        });
      }

      // Load all local competitors + classes for this competition.
      const localCompetitors = app.fartolaDb.db
        .select({
          id: competitorsTable.id,
          name: competitorsTable.name,
          club: competitorsTable.club,
          classId: competitorsTable.classId,
          cardNumber: competitorsTable.cardNumber,
          startTimeMs: competitorsTable.startTimeMs,
        })
        .from(competitorsTable)
        .where(eq(competitorsTable.competitionId, competitionId))
        .all() as CompetitorRow[];

      const localClasses = app.fartolaDb.db
        .select({ id: classesTable.id, name: classesTable.name })
        .from(classesTable)
        .where(eq(classesTable.competitionId, competitionId))
        .all() as ClassRow[];

      const classNameToId = new Map(localClasses.map((c) => [normalizeName(c.name), c.id]));

      // Match imported entries to local competitors.
      const fuzzyMatches: FuzzyMatch[] = [];
      const cardUpdates: CardUpdate[] = [];
      const skipped: SkippedImportRow[] = [];

      // Track names within each class for duplicate detection (GPT+Gemini HIGH fix).
      // If two local competitors in the same class have the same normalized name,
      // both must be flagged as fuzzy (duplicate risk), not silently matched.
      const nameCountByClass = new Map<string, Map<string, number>>();
      for (const c of localCompetitors) {
        const classMap = nameCountByClass.get(c.classId) ?? new Map<string, number>();
        const normalized = normalizeName(c.name);
        classMap.set(normalized, (classMap.get(normalized) ?? 0) + 1);
        nameCountByClass.set(c.classId, classMap);
      }

      // Card-number index for O(1) exact SI card lookup.
      const byCard = new Map<number, CompetitorRow[]>();
      for (const c of localCompetitors) {
        if (c.cardNumber !== null) {
          const existing = byCard.get(c.cardNumber) ?? [];
          existing.push(c);
          byCard.set(c.cardNumber, existing);
        }
      }

      // Exact matches that need start_time_ms (and, for a changed card,
      // card_number) written.
      const exactWrites: Array<{
        id: string;
        startTimeMs: number;
        cardNumber?: number;
        entry: (typeof entries)[number];
      }> = [];

      const skipRow = (
        entry: (typeof entries)[number],
        reason: SkippedImportRow['reason']
      ): void => {
        skipped.push({
          row: entry.row,
          name: entry.name,
          class: entry.className,
          card: entry.siCard,
          reason,
        });
      };

      // Rows that share a card can't all be right, and matching one would let
      // the next row find that runner by the card and overwrite their start:
      // none of them is applied.
      const rowsPerCard = new Map<number, number>();
      for (const entry of entries) {
        if (entry.siCard !== null) {
          rowsPerCard.set(entry.siCard, (rowsPerCard.get(entry.siCard) ?? 0) + 1);
        }
      }

      for (const entry of entries) {
        const skip = (reason: SkippedImportRow['reason']): void => skipRow(entry, reason);
        const classId = classNameToId.get(normalizeName(entry.className));
        if (classId === undefined) {
          skip('unknown_class');
          continue;
        }
        if (entry.startTimeMs === null) {
          skip('no_start_time');
          continue;
        }

        if (entry.siCard !== null && (rowsPerCard.get(entry.siCard) ?? 0) > 1) {
          skip('duplicate_card');
          continue;
        }

        // 1. Exact match: SI card.
        if (entry.siCard !== null) {
          const cardMatches = byCard.get(entry.siCard) ?? [];
          // Filter to same class.
          const sameClass = cardMatches.filter((c) => c.classId === classId);
          if (sameClass.length === 1 && sameClass[0] !== undefined) {
            exactWrites.push({ id: sameClass[0].id, startTimeMs: entry.startTimeMs, entry });
            continue;
          }

          // Card did not match: same name + club (exact, case-insensitive)
          // in the same class means the runner changed or rented a card.
          // MeOS matches the same way and takes the start list's card.
          const club = entry.club === null ? null : normalizeName(entry.club);
          const byNameClub =
            club === null
              ? []
              : localCompetitors.filter(
                  (c) =>
                    c.classId === classId &&
                    normalizeName(c.name) === normalizeName(entry.name) &&
                    c.club !== null &&
                    normalizeName(c.club) === club
                );
          if (byNameClub.length === 1 && byNameClub[0] !== undefined) {
            const target = byNameClub[0];
            // D-11: a card already held by someone else cannot be taken.
            if (cardMatches.some((c) => c.id !== target.id)) {
              skip('duplicate_card');
              continue;
            }
            exactWrites.push({
              id: target.id,
              startTimeMs: entry.startTimeMs,
              cardNumber: entry.siCard,
              entry,
            });
            cardUpdates.push({
              row: entry.row,
              competitor_id: target.id,
              name: target.name,
              class: entry.className,
              previous_card: target.cardNumber,
              card: entry.siCard,
            });
            // Later rows must see the new card as taken and the old one free.
            if (target.cardNumber !== null) byCard.delete(target.cardNumber);
            byCard.set(entry.siCard, [target]);
            continue;
          }
        }

        // 2. Fuzzy match: name + class. Require unique name within the class.
        const normalizedEntry = normalizeName(entry.name);
        const classNameCounts = nameCountByClass.get(classId);
        const localCount = classNameCounts?.get(normalizedEntry) ?? 0;
        if (localCount === 1) {
          // Exactly one local competitor with this name in this class.
          const candidate = localCompetitors.find(
            (c) => c.classId === classId && normalizeName(c.name) === normalizedEntry
          );
          if (candidate !== undefined) {
            fuzzyMatches.push({
              imported: {
                name: entry.name,
                className: entry.className,
                startTimeMs: entry.startTimeMs,
                siCard: entry.siCard,
                bibNumber: entry.bibNumber,
              },
              candidate: { id: candidate.id, name: candidate.name, classId: candidate.classId },
              confidence: 'name_class',
            });
            continue;
          }
        }

        // No match (or ambiguous duplicate name).
        skip('no_match');
      }

      // Two imported rows resolving to the same runner (e.g. one by card, one
      // by name + club) would silently overwrite each other: apply neither.
      const rowsPerTarget = new Map<string, number>();
      for (const w of exactWrites) rowsPerTarget.set(w.id, (rowsPerTarget.get(w.id) ?? 0) + 1);
      for (let i = exactWrites.length - 1; i >= 0; i--) {
        const w = exactWrites[i]!;
        if (rowsPerTarget.get(w.id)! < 2) continue;
        exactWrites.splice(i, 1);
        const update = cardUpdates.findIndex((u) => u.row === w.entry.row);
        if (update !== -1) cardUpdates.splice(update, 1);
        skipRow(w.entry, 'duplicate_runner');
      }
      // A dropped card change no longer frees its runner's old card, which a
      // later row may have taken. Replay the remaining changes in row order
      // against the cards actually held; one that takes a held card is
      // dropped too.
      const cardHolder = new Map<number, string>();
      const cardOf = new Map<string, number | null>();
      for (const c of localCompetitors) {
        if (c.cardNumber !== null) cardHolder.set(c.cardNumber, c.id);
        cardOf.set(c.id, c.cardNumber);
      }
      for (let i = 0; i < exactWrites.length; i++) {
        const w = exactWrites[i]!;
        if (w.cardNumber === undefined) continue;
        const holder = cardHolder.get(w.cardNumber);
        if (holder !== undefined && holder !== w.id) {
          exactWrites.splice(i--, 1);
          const update = cardUpdates.findIndex((u) => u.row === w.entry.row);
          if (update !== -1) cardUpdates.splice(update, 1);
          skipRow(w.entry, 'duplicate_card');
          continue;
        }
        const previous = cardOf.get(w.id);
        if (previous !== null && previous !== undefined) cardHolder.delete(previous);
        cardHolder.set(w.cardNumber, w.id);
        cardOf.set(w.id, w.cardNumber);
      }
      skipped.sort((a, b) => a.row - b.row);
      const exactCount = exactWrites.filter((w) => w.cardNumber === undefined).length;

      // Write exact matches in a single transaction: cards on the row, start
      // times as one start_times_set event (ADR-0003 update 2026-10).
      if (exactWrites.length > 0) {
        app.fartolaDb.sqlite.transaction(() => {
          for (const w of exactWrites) {
            if (w.cardNumber === undefined) continue;
            app.fartolaDb.db
              .update(competitorsTable)
              .set({ cardNumber: w.cardNumber })
              .where(
                and(
                  eq(competitorsTable.id, w.id),
                  eq(competitorsTable.competitionId, competitionId)
                )
              )
              .run();
          }
          writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
            cause: 'start_list_import',
            classId: null,
            changes: exactWrites.map((w) => ({ competitorId: w.id, startTimeMs: w.startTimeMs })),
          });
        })();
      }
      app.projectionStore.markDirty(competitionId);

      const result: StartListMatchResult = {
        exact: exactCount,
        fuzzy: fuzzyMatches.length,
        unmatched: skipped.length,
        card_updated: cardUpdates.length,
        fuzzyMatches,
        cardUpdates,
        skipped,
      };
      return reply.code(201).send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/import/startlist/confirm
  //
  // Applies operator-confirmed fuzzy matches from the previous startlist import.
  // Idempotent: if start_time_ms already equals the imported value, the write
  // is skipped and counted as alreadyApplied (DeepSeek HIGH fix).
  //
  // Request body: { matches: Array<{ competitorId: string, startTimeMs: number }> }
  // Response:
  //   200 { applied: N, alreadyApplied: M }
  //   400 { error: 'bad_body' }
  //   404 { error: 'competition_not_found' }
  // ---------------------------------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: { matches: Array<{ competitorId: string; startTimeMs: number }> };
  }>('/api/competitions/:id/import/startlist/confirm', async (req, reply) => {
    const competitionId = req.params.id;

    const comp = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!comp) {
      return reply.code(404).send({ error: 'competition_not_found' });
    }

    // The whole batch is validated before anything is written; start times
    // must be epoch ms like every other start-time write (StartTimeMs).
    const parsed = ConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', ...issuesToErrors(parsed.error.issues) });
    }
    const { matches } = parsed.data;

    let applied = 0;
    let alreadyApplied = 0;
    const changes: Array<{ competitorId: string; startTimeMs: number }> = [];

    // Idempotent: check existing start_time_ms before writing.
    app.fartolaDb.sqlite.transaction(() => {
      for (const m of matches) {
        const existing = app.fartolaDb.db
          .select({ id: competitorsTable.id, startTimeMs: competitorsTable.startTimeMs })
          .from(competitorsTable)
          .where(
            and(
              eq(competitorsTable.id, m.competitorId),
              eq(competitorsTable.competitionId, competitionId)
            )
          )
          .get() as { id: string; startTimeMs: number | null } | undefined;

        if (!existing) continue; // Competitor not in this competition — skip silently.

        if (existing.startTimeMs === m.startTimeMs) {
          // Already applied — idempotent, skip write.
          alreadyApplied += 1;
          continue;
        }

        changes.push({ competitorId: m.competitorId, startTimeMs: m.startTimeMs });
        applied += 1;
      }
      writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
        cause: 'start_list_import',
        classId: null,
        changes,
      });
    })();

    if (applied > 0) {
      app.projectionStore.markDirty(competitionId);
    }

    return reply.code(200).send({ applied, alreadyApplied });
  });

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/import/previous-results — an earlier stage's
  // IOF XML 3.0 ResultList (day 1 from MeOS, OLA or Eventor) for a pursuit
  // (SOFT TR 7.4.1). Matches every runner of this competition (Eventor id,
  // then unique name + club) and stores the result on the runner
  // (competitors.input_time_ms / input_status, MeOS inputTime/inputStatus);
  // a new file replaces the old. Unmatched runners are listed, not refused:
  // they start in the pursuit's restart block.
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/import/previous-results',
    async (req, reply) => {
      const competitionId = req.params.id;
      const comp = app.fartolaDb.db
        .select({ id: competitions.id })
        .from(competitions)
        .where(eq(competitions.id, competitionId))
        .get();
      if (!comp) return reply.code(404).send({ error: 'competition_not_found' });

      const part = await req.file();
      if (!part) return reply.code(400).send({ error: 'no_file', message: 'Förväntar en fil.' });
      let xmlSource: string;
      try {
        xmlSource = (await part.toBuffer()).toString('utf8');
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(msg))
          return reply.code(413).send({ error: 'file_too_large' });
        return reply.code(400).send({ error: 'bad_upload', detail: msg });
      }
      if (/<!DOCTYPE|<!ENTITY/i.test(xmlSource))
        return reply
          .code(400)
          .send({ error: 'parse_failed', detail: 'DOCTYPE/ENTITY not allowed' });
      const validation = await validateXml(xmlSource);
      if (!validation.valid)
        return reply.code(400).send({
          error: 'xsd_invalid',
          message: 'ResultList XML klarade inte XSD-validering.',
          errors: validation.errors.slice(0, 10),
        });
      let results;
      try {
        results = importResultList(xmlSource);
      } catch (e) {
        return reply.code(400).send({ error: 'parse_failed', detail: (e as Error).message });
      }

      const runners = app.fartolaDb.db
        .select({
          id: competitorsTable.id,
          name: competitorsTable.name,
          club: competitorsTable.club,
          eventorPersonId: competitorsTable.eventorPersonId,
          className: classesTable.name,
        })
        .from(competitorsTable)
        .innerJoin(classesTable, eq(classesTable.id, competitorsTable.classId))
        .where(eq(competitorsTable.competitionId, competitionId))
        .all();
      // The file replaces the results of the classes it contains (OLA exports
      // one file per class); other classes keep theirs.
      const fileClasses = new Set(results.map((r) => r.className));
      const scoped = runners.filter((r) => fileClasses.has(r.className));
      const { matched, unmatched } = matchPreviousStage(scoped, results);
      app.fartolaDb.sqlite.transaction(() => {
        app.fartolaDb.db
          .update(competitorsTable)
          .set({ inputTimeMs: null, inputStatus: null })
          .where(
            inArray(
              competitorsTable.id,
              scoped.map((r) => r.id)
            )
          )
          .run();
        for (const m of matched)
          app.fartolaDb.db
            .update(competitorsTable)
            .set({ inputTimeMs: m.timeMs, inputStatus: m.status })
            .where(eq(competitorsTable.id, m.id))
            .run();
      })();
      const classOf = new Map(runners.map((r) => [r.id, r.className]));
      return reply.code(201).send({
        results: results.length,
        matched: matched.length,
        unmatched: unmatched.map((u) => ({
          competitor_id: u.id,
          name: u.name,
          club: u.club,
          class_name: classOf.get(u.id) ?? '',
        })),
      });
    }
  );

  app.post<{ Params: { id: string } }>('/api/competitions/:id/import', async (req, reply) => {
    const competitionId = req.params.id;
    const part = await req.file();
    if (!part) {
      return reply.code(400).send({
        error: 'no_file',
        message: 'Förväntar en fil.',
      });
    }
    // T-PATH-TRAVERSAL: filename is metadata only and @fastify/multipart
    // already strips the path component via basename, but reject the
    // obvious adversarial cases up front as defense-in-depth in case a
    // future multipart upgrade changes that behavior.
    const filename = part.filename;
    if (filename.includes('..') || isAbsolute(filename)) {
      return reply.code(400).send({ error: 'bad_filename' });
    }

    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // @fastify/multipart throws { code: 'FST_REQ_FILE_TOO_LARGE' } via
      // its error class. Map to a 413 explicitly.
      if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(msg)) {
        return reply.code(413).send({ error: 'file_too_large' });
      }
      return reply.code(400).send({ error: 'bad_upload', detail: msg });
    }
    const xmlSource = bytes.toString('utf8');

    let parsed;
    try {
      parsed = parseIofXml(xmlSource);
    } catch (e) {
      return reply.code(400).send({
        error: 'parse_failed',
        message:
          'Filen kunde inte läsas — förväntar Purple Pen .xml (IOF XML 3.0 CourseData) eller IOF XML 3.0 EntryList.',
        detail: (e as Error).message,
      });
    }

    const validation = await validateXml(xmlSource);
    if (!validation.valid) {
      return reply.code(400).send({
        error: 'xsd_invalid',
        errors: validation.errors,
      });
    }

    const comp = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!comp) {
      return reply.code(404).send({ error: 'competition_not_found' });
    }

    try {
      if (parsed.kind === 'CourseData') {
        const result = ingestCourseData(app.fartolaDb, competitionId, parsed.data);
        // Courses/classes changed: cached results must be re-scored.
        app.projectionStore.markDirty(competitionId);
        return reply.code(201).send({ kind: 'CourseData', ...result });
      } else {
        const result = ingestEntryList(app.fartolaDb, competitionId, parsed.data, Date.now());
        // Plan 09: close the import-after-read race. The bridge may have
        // already inserted card_read events for cards belonging to the
        // newly-imported competitors. autoBindNewCompetitors emits one
        // synthetic card_bound per match so the next reduce() drops the
        // card from pending_unknown_cards AND attaches the prior read.
        const autoBind = autoBindNewCompetitors(app.fartolaDb, competitionId, app.fartolaNodeId);
        // New runners (and any new bindings) change the cached results.
        app.projectionStore.markDirty(competitionId);
        return reply.code(201).send({ kind: 'EntryList', ...result, auto_bound: autoBind.bound });
      }
    } catch (e) {
      const msg = (e as Error).message ?? 'ingest failed';
      app.log.warn({ err: msg, competitionId }, 'ingest failed');
      return reply.code(422).send({
        error: 'ingest_failed',
        detail: msg,
      });
    }
  });
}
