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
import { and, eq } from 'drizzle-orm';
import { isAbsolute } from 'node:path';
import multipart from '@fastify/multipart';

import {
  competitions,
  competitors as competitorsTable,
  classes as classesTable,
} from '../db/schema.ts';
import { parseIofXml } from '../xml/parse.ts';
import { validateXml } from '../xml/validate.ts';
import { importStartList } from '../xml/iofImport.ts';
import { ingestCourseData } from '../ingest/courseImport.ts';
import { ingestEntryList } from '../ingest/entryImport.ts';
import { autoBindNewCompetitors } from '../projection/auto-bind.ts';

// ---------------------------------------------------------------------------
// StartList matching helpers (plan 02.1-03).
// ---------------------------------------------------------------------------

/** A competitor row from the DB — minimal fields for matching. */
interface CompetitorRow {
  id: string;
  name: string;
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

export interface StartListMatchResult {
  exact: number;
  fuzzy: number;
  unmatched: number;
  fuzzyMatches: FuzzyMatch[];
}

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
        .select({ id: competitions.id })
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
        entries = importStartList(xmlSource);
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
      let exactCount = 0;
      let unmatchedCount = 0;
      const fuzzyMatches: FuzzyMatch[] = [];

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

      // Exact matches that need start_time_ms written.
      const exactWrites: Array<{ id: string; startTimeMs: number }> = [];

      for (const entry of entries) {
        const classId = classNameToId.get(normalizeName(entry.className));
        if (classId === undefined) {
          // Class not found in this competition — unmatched.
          unmatchedCount += 1;
          continue;
        }

        // 1. Exact match: SI card.
        if (entry.siCard !== null) {
          const cardMatches = byCard.get(entry.siCard) ?? [];
          // Filter to same class.
          const sameClass = cardMatches.filter((c) => c.classId === classId);
          if (sameClass.length === 1 && sameClass[0] !== undefined) {
            exactWrites.push({ id: sameClass[0].id, startTimeMs: entry.startTimeMs });
            exactCount += 1;
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
        unmatchedCount += 1;
      }

      // Write exact matches in a single transaction.
      if (exactWrites.length > 0) {
        app.fartolaDb.sqlite.transaction(() => {
          for (const w of exactWrites) {
            app.fartolaDb.db
              .update(competitorsTable)
              .set({ startTimeMs: w.startTimeMs })
              .where(
                and(
                  eq(competitorsTable.id, w.id),
                  eq(competitorsTable.competitionId, competitionId)
                )
              )
              .run();
          }
        })();
        app.projectionStore.markDirty(competitionId);
      }

      const result: StartListMatchResult = {
        exact: exactCount,
        fuzzy: fuzzyMatches.length,
        unmatched: unmatchedCount,
        fuzzyMatches,
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

    const body = req.body as { matches?: unknown };
    if (!Array.isArray(body?.matches)) {
      return reply.code(400).send({ error: 'bad_body', message: 'matches must be an array' });
    }

    const matches = body.matches as Array<{ competitorId: unknown; startTimeMs: unknown }>;

    let applied = 0;
    let alreadyApplied = 0;

    // Idempotent: check existing start_time_ms before writing.
    app.fartolaDb.sqlite.transaction(() => {
      for (const m of matches) {
        if (typeof m.competitorId !== 'string' || typeof m.startTimeMs !== 'number') continue;
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

        app.fartolaDb.db
          .update(competitorsTable)
          .set({ startTimeMs: m.startTimeMs })
          .where(
            and(
              eq(competitorsTable.id, m.competitorId),
              eq(competitorsTable.competitionId, competitionId)
            )
          )
          .run();
        applied += 1;
      }
    })();

    if (applied > 0) {
      app.projectionStore.markDirty(competitionId);
    }

    return reply.code(200).send({ applied, alreadyApplied });
  });

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
        return reply.code(201).send({ kind: 'CourseData', ...result });
      } else {
        const result = ingestEntryList(app.fartolaDb, competitionId, parsed.data, Date.now());
        // Plan 09: close the import-after-read race. The bridge may have
        // already inserted card_read events for cards belonging to the
        // newly-imported competitors. autoBindNewCompetitors emits one
        // synthetic card_bound per match so the next reduce() drops the
        // card from pending_unknown_cards AND attaches the prior read.
        const autoBind = autoBindNewCompetitors(app.fartolaDb, competitionId, app.fartolaNodeId);
        if (autoBind.bound.length > 0) {
          app.projectionStore.markDirty(competitionId);
        }
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
