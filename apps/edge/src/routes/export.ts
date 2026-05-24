// Authored for fartola. Not ported from upstream.
//
// REST handlers for the IOF XML 3.0 ResultList export surface:
//
//   - GET /api/competitions/:id/export/preview[?status=Final|Provisional]
//     → 200 { valid: true, summary: { class_count, person_result_count,
//             status } } when the projection serialises to XSD-valid XML.
//     → 200 { valid: false, errors: XsdError[] } when validation fails.
//     The preview endpoint is the wired-in indicator on the export page
//     (green check + class/person counts, OR red list of XSD errors).
//
//   - GET /api/competitions/:id/export?format=iof30[&status=Final|Provisional]
//     → 200 with Content-Type application/xml + Content-Disposition
//       attachment so the browser triggers a download.
//     → 400 { error: 'xsd_invalid', errors: [...] } if validation fails
//       (SC#6 binding contract: the file body is NEVER written to the
//       response stream unless validateXml returned valid=true).
//     → 400 { error: 'unsupported_format' } for any format ≠ 'iof30'.
//     → 404 when the competition row is missing.
//
// Both handlers source the projection via app.projectionStore.recomputeNow
// (the same path the WS results channel uses) so a freshly-booted bridge
// returns the current snapshot without waiting for a markDirty round-trip.
//
// W-5 locked behavior: empty competitions (zero events) return 200 with a
// valid empty ResultList (zero ClassResult children) per
// ResultList > ClassResult minOccurs=0 in the bundled XSD. The route does
// NOT 422 on emptiness — the XML is well-formed AND XSD-valid.
//
// C-L1 default-status lock: when the `status` query param is absent, the
// route defaults to 'Final', which the builder maps to @status='Complete'.
// This is the route-layer half of the W-4 enum lock (the other half lives
// in apps/edge/src/xml/iofExport.ts test 3).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-16-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Export IOF XML 3.0 ResultList"
// - REQ-EVT-CMP-008 + REQ-STD-002 + SC#6

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import {
  competitions,
  classes as classesTable,
  competitors as competitorsTable,
} from '../db/schema.ts';
import {
  validateAndBuild,
  validateAndBuildStartList,
  type ExportStatus,
  type ExportInput,
  type StartListInput,
  type StartListCompetitor,
} from '../xml/iofExport.ts';
import type { CompetitionDTO, ClassDTO } from '@fartola/shared-types';

function parseStatus(raw: unknown): ExportStatus {
  // C-L1: default to 'Final' when absent / unknown. The query layer is
  // string-only; we recognise the two canonical UI labels.
  return raw === 'Provisional' ? 'Provisional' : 'Final';
}

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Strip combining diacritics (NFKD splits e.g. "ö" into "o" + ̈).
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'competition'
  );
}

interface CompetitionRow {
  id: string;
  name: string;
  date: string;
  receiptTemplate: string;
  autoPrint: boolean;
  createdAtMs: number;
  raceStartedAtMs: number | null;
  timingFormat: string | null;
}

interface ClassRow {
  id: string;
  competitionId: string;
  name: string;
  shortName: string | null;
}

function competitionRowToDTO(row: CompetitionRow): CompetitionDTO {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    // ReceiptTemplate is plain TEXT at the column layer; the export path
    // doesn't read this field semantically (the IOF XML doesn't carry it),
    // so a loose cast is safe.
    receipt_template: row.receiptTemplate as CompetitionDTO['receipt_template'],
    auto_print: row.autoPrint,
    created_at_ms: row.createdAtMs,
    race_started_at_ms: row.raceStartedAtMs,
    timing_format: row.timingFormat === 'tenths' ? 'tenths' : 'seconds',
  };
}

function classRowToDTO(row: ClassRow): ClassDTO {
  return {
    id: row.id,
    competition_id: row.competitionId,
    name: row.name,
    short_name: row.shortName,
  };
}

export default async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/competitions/:id/export/preview
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/api/competitions/:id/export/preview',
    async (req, reply) => {
      const { id } = req.params;
      const status = parseStatus(req.query.status);

      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .get() as CompetitionRow | undefined;
      if (!compRow) {
        void reply.code(404).send({ error: 'competition_not_found' });
        return;
      }

      const classRows = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.competitionId, id))
        .all() as ClassRow[];

      const state = app.projectionStore.recomputeNow(id);
      if (state === null) {
        // Should not happen given the comp row exists, but defend against a
        // race between the SELECT and the projection load.
        void reply.code(404).send({ error: 'competition_not_found' });
        return;
      }

      const input: ExportInput = {
        competition: competitionRowToDTO(compRow),
        classes: classRows.map(classRowToDTO),
        courses: [],
        state,
        status,
      };
      const result = await validateAndBuild(input);
      if (!result.valid) {
        return reply.code(200).send({ valid: false, errors: result.errors });
      }
      return reply.code(200).send({ valid: true, summary: result.build.summary });
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/competitions/:id/export?format=iof30
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { format?: string; status?: string } }>(
    '/api/competitions/:id/export',
    async (req, reply) => {
      const { id } = req.params;
      const format = req.query.format;
      const status = parseStatus(req.query.status);

      if (format !== 'iof30') {
        return reply.code(400).send({ error: 'unsupported_format' });
      }

      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .get() as CompetitionRow | undefined;
      if (!compRow) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      const classRows = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.competitionId, id))
        .all() as ClassRow[];

      const state = app.projectionStore.recomputeNow(id);
      if (state === null) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      const input: ExportInput = {
        competition: competitionRowToDTO(compRow),
        classes: classRows.map(classRowToDTO),
        courses: [],
        state,
        status,
      };
      const result = await validateAndBuild(input);
      if (!result.valid) {
        // SC#6 binding contract: never stream a partial XML body on
        // validation failure. Surface the XSD errors in a JSON envelope
        // and use 400 so the UI's download CTA can branch cleanly.
        return reply.code(400).send({ error: 'xsd_invalid', errors: result.errors });
      }

      const slug = slugifyName(compRow.name);
      void reply.header('Content-Type', 'application/xml; charset=utf-8');
      void reply.header('Content-Disposition', `attachment; filename="${slug}-resultlist.xml"`);
      return reply.code(200).send(result.build.xml);
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/competitions/:id/export/startlist
  //
  // Exports an IOF XML 3.0 StartList from the competition's drawn competitors.
  // Only competitors with a non-null start_time_ms are included. Validates via
  // the bundled IOF.xsd (SC#6 contract) before streaming.
  //
  //   → 200 application/xml + Content-Disposition attachment
  //   → 400 { error: 'xsd_invalid', errors: [...] }
  //   → 404 { error: 'competition_not_found' }
  //
  // Locked by:
  // - .planning/phases/02.1-sanctioned-competition-foundations/02.1-03-PLAN.md task 2
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/export/startlist',
    async (req, reply) => {
      const { id } = req.params;

      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .get() as CompetitionRow | undefined;
      if (!compRow) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      const classRows = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.competitionId, id))
        .all() as ClassRow[];

      // Load competitors with start times.
      interface CompetitorStartRow {
        id: string;
        name: string;
        club: string | null;
        classId: string;
        cardNumber: number | null;
        startTimeMs: number | null;
      }
      const competitorRows = app.fartolaDb.db
        .select({
          id: competitorsTable.id,
          name: competitorsTable.name,
          club: competitorsTable.club,
          classId: competitorsTable.classId,
          cardNumber: competitorsTable.cardNumber,
          startTimeMs: competitorsTable.startTimeMs,
        })
        .from(competitorsTable)
        .where(eq(competitorsTable.competitionId, id))
        .all() as CompetitorStartRow[];

      // Group competitors by class.
      const byClass = new Map<string, CompetitorStartRow[]>();
      for (const c of competitorRows) {
        const arr = byClass.get(c.classId) ?? [];
        arr.push(c);
        byClass.set(c.classId, arr);
      }

      const startListClasses: StartListInput['classes'] = classRows.map((cls) => {
        const classCompetitors = byClass.get(cls.id) ?? [];
        return {
          name: cls.name,
          competitors: classCompetitors.map(
            (c): StartListCompetitor => ({
              name: c.name,
              club: c.club,
              startTimeMs: c.startTimeMs,
              // No bibNumber on this path — bib allocation is a future plan.
            })
          ),
        };
      });

      const input: StartListInput = {
        competition: competitionRowToDTO(compRow),
        classes: startListClasses,
      };

      const result = await validateAndBuildStartList(input);
      if (!result.valid) {
        return reply.code(400).send({ error: 'xsd_invalid', errors: result.errors });
      }

      const slug = slugifyName(compRow.name);
      void reply.header('Content-Type', 'application/xml; charset=utf-8');
      void reply.header('Content-Disposition', `attachment; filename="${slug}-startlist.xml"`);
      return reply.code(200).send(result.build.xml);
    }
  );
}
