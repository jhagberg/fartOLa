// Authored for fartola. Not ported from upstream.
//
// POST /api/competitions/from-wizard — atomic competition create + XML
// ingest (C-H3 LOCKED).
//
// Per codex review C-H3: HTTP requests cannot share a SQL transaction, so
// the wizard's "create competition, then import XML" two-call shape was
// eligible for partial commit — a parse / XSD / ingest failure AFTER the
// competition INSERT would leave an orphan row that Phase 1 has no
// DELETE-competition endpoint to clean up. This endpoint replaces the
// two-call shape with a single primitive: one HTTP request → one
// sqlite.transaction wrapping BOTH the competition INSERT and the ingest.
// On any throw inside the transaction (parse error caught up-front, XSD
// reject caught up-front, ingestCourseData throwing on an unknown control
// code, ingestEntryList throwing when no classes exist yet), better-
// sqlite3 rolls the whole unit back — no orphan competition row, no
// manual cleanup, no DELETE-competition endpoint required in Phase 1.
//
// Plan 12 wizard step 3 fires ONE POST to this endpoint instead of two
// sequential POSTs.
//
// Body contract:
//   {
//     name: string,            // min 1, max 200
//     date: string,            // 'YYYY-MM-DD' regex
//     xml_file: {
//       name: string,          // filename metadata; sanitized
//       content_base64: string // XML bytes, base64-encoded, ≤ 5 MB after decode
//     }
//   }
//
// T-LARGE-BODY-DOS: the decoded byte length is checked against 5 MB. The
// Fastify default body limit (1 MB) is the FIRST gate but the wizard's
// 5 MB cap requires lifting it on this route. We do that locally via the
// bodyLimit route option.
//
// T-PATH-TRAVERSAL: xml_file.name is metadata only — used for the audit
// log and error messages. Bytes flow via content_base64. Filename never
// touches the filesystem. Sanitize anyway: '..' or absolute path → 400.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H3
//   (atomic create + import in ONE SQL transaction is the only way to
//   guarantee no orphan competition rows on import failure)

import { z } from 'zod';
import crypto from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { competitions } from '../db/schema.ts';
import { parseIofXml } from '../xml/parse.ts';
import { validateXml } from '../xml/validate.ts';
import { ingestCourseData } from '../ingest/courseImport.ts';
import { ingestEntryList } from '../ingest/entryImport.ts';
import { issuesToErrors } from './_zod-errors.ts';

const FromWizardSchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  xml_file: z.object({
    name: z.string().min(1).max(255),
    content_base64: z.string().min(1),
  }),
  /** Plan 11 — optional Eventor event ID set by the wizard quickstart path.
   * When present, stored on the competition row so ImportRunnersView can
   * show the linked-event card and the competition list can show the chip. */
  eventor_event_id: z.number().int().positive().nullable().optional(),
});

const MAX_DECODED_BYTES = 5 * 1024 * 1024;
// 5 MB after base64 expand = ~6.7 MB on the wire; the bodyLimit must cover
// that plus the JSON envelope (name, date, filename, key names + quotes +
// braces). 7.5 MB gives ~800 KB of headroom for the envelope without
// letting genuinely oversized payloads (e.g. 6 MB raw = 8 MB encoded)
// reach the decode-check path; those get caught by Fastify's bodyLimit
// gate FIRST and surface as a generic 413, which is still semantically
// correct (T-LARGE-BODY-DOS — the threat is mitigated either way).
const BODY_LIMIT_BYTES = Math.ceil(7.5 * 1024 * 1024);

export default async function registerCompetitionsFromWizard(app: FastifyInstance): Promise<void> {
  app.post('/api/competitions/from-wizard', { bodyLimit: BODY_LIMIT_BYTES }, async (req, reply) => {
    const parsed = FromWizardSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const { name, date, xml_file, eventor_event_id } = parsed.data;

    if (xml_file.name.includes('..') || isAbsolute(xml_file.name)) {
      return reply.code(400).send({ error: 'bad_filename' });
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(xml_file.content_base64, 'base64');
    } catch {
      return reply.code(400).send({ error: 'bad_base64' });
    }
    if (bytes.byteLength === 0) {
      // Node tolerates garbage in Buffer.from(..., 'base64') by silently
      // skipping invalid characters — an all-garbage payload decodes to
      // an empty buffer. Surface as bad_base64 so the client doesn't
      // think the upload succeeded.
      return reply.code(400).send({ error: 'bad_base64' });
    }
    if (bytes.byteLength > MAX_DECODED_BYTES) {
      return reply.code(413).send({ error: 'file_too_large' });
    }
    const xmlSource = bytes.toString('utf8');

    // Parse + XSD BEFORE opening the transaction so the easy-failure
    // cases never reserve a competitions row. The C-H3 atomic guarantee
    // covers the OTHER cases (mid-transaction throws).
    let parsedXml;
    try {
      parsedXml = parseIofXml(xmlSource);
    } catch (e) {
      return reply.code(400).send({
        error: 'parse_failed',
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

    const competitionId = crypto.randomUUID();
    const now = Date.now();
    let ingestResult: unknown = null;
    let kind: 'CourseData' | 'EntryList' = parsedXml.kind;

    try {
      app.fartolaDb.sqlite.transaction(() => {
        app.fartolaDb.db
          .insert(competitions)
          .values({
            id: competitionId,
            name,
            date,
            receiptTemplate: 'classic',
            autoPrint: false,
            createdAtMs: now,
            // Plan 11 — persist Eventor linkage from the wizard quickstart path.
            eventorEventId: eventor_event_id ?? null,
          })
          .run();
        if (parsedXml.kind === 'CourseData') {
          kind = 'CourseData';
          ingestResult = ingestCourseData(app.fartolaDb, competitionId, parsedXml.data, {
            outerTransaction: true,
          });
        } else {
          kind = 'EntryList';
          ingestResult = ingestEntryList(app.fartolaDb, competitionId, parsedXml.data, now, {
            outerTransaction: true,
          });
        }
      })();
    } catch (e) {
      const msg = (e as Error).message ?? 'ingest failed';
      app.log.warn({ err: msg, competitionId, kind }, 'from-wizard transaction rolled back');
      // The "EntryList against an empty competition" path surfaces a
      // distinct error code so the wizard can render a precise toast.
      const errorCode = /upload CourseData first/i.test(msg)
        ? 'entrylist_without_courses'
        : 'ingest_failed';
      return reply.code(422).send({ error: errorCode, detail: msg });
    }

    return reply.code(201).send({
      competition_id: competitionId,
      kind,
      ...(ingestResult as object),
    });
  });
}
