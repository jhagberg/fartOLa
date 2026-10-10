// Authored for fartola. Not ported from upstream.
//
// POST routes for pushing IOF XML 3.0 results and startlists to Eventor
// (Plan 02.1-08 task 1). Two endpoints:
//
//   POST /api/competitions/:id/eventor/push-results
//     — loads projection, builds ResultList XML, pushes to Eventor, returns { url }
//
//   POST /api/competitions/:id/eventor/push-startlist
//     — loads competitors with start_time_ms, builds StartList XML, pushes, returns { url }
//
// Both routes:
//   - Resolve the EVENTOR_API_KEY via resolveSecret (env > config > absent)
//   - Return 400 { error: 'no_api_key' } when key is missing
//   - Return 404 { error: 'competition_not_found' } when comp is absent
//   - Return 200 { url: string } on success (the Eventor result/startlist URL)
//   - Return 500 { error: 'push_failed', message: string } on push failure
//
// push-results validates the ResultList against the bundled IOF.xsd before
// pushing (400 { error: 'xsd_invalid', errors } otherwise), like the export
// download: it is the list Eventor builds Sverigelistan and the competition
// report from (SOFT TR 7.8.3), with person ids and course lengths (TA till
// TR 7.8.3, TR 7.8.2). push-startlist builds without validation; Eventor
// validates the format server-side.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-08-PLAN.md task 1
// - D-11: POST /api/competitions/:id/eventor/push-results|push-startlist
// - D-12: pushToEventor sends PKZIP-archived IOF XML 3.0 with ApiKey header

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { competitions, classes as classesTable } from '../db/schema.ts';
import { resolveSecret } from '../config/secrets.ts';
import { pushToEventor } from '../eventor/push.ts';
import { buildStartListXml, validateAndBuild, type ExportStatus } from '../xml/iofExport.ts';
import type { CompetitionState } from '../projection/types.ts';
import { resultListInputs } from './_resultListInputs.ts';
import { startListClasses } from './_startListInputs.ts';
import { competitionClockOffsetMin } from '../time/competitionClock.ts';
import type { CompetitionDTO, StartMethod } from '@fartola/shared-types';

// ---------------------------------------------------------------------------
// Helpers (mirrors export.ts — shared row shapes)
// ---------------------------------------------------------------------------

interface CompetitionRow {
  id: string;
  name: string;
  date: string;
  receiptTemplate: string;
  autoPrint: boolean;
  createdAtMs: number;
  raceStartedAtMs: number | null;
  timingFormat: string | null;
  clockOffsetMin: number | null;
}

interface ClassRow {
  id: string;
  competitionId: string;
  name: string;
  shortName: string | null;
  noTiming: boolean;
  startMethod: StartMethod;
  courseId: string | null;
}

function competitionRowToDTO(row: CompetitionRow): CompetitionDTO {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    receipt_template: row.receiptTemplate as CompetitionDTO['receipt_template'],
    auto_print: row.autoPrint,
    created_at_ms: row.createdAtMs,
    race_started_at_ms: row.raceStartedAtMs,
    timing_format: row.timingFormat === 'tenths' ? 'tenths' : 'seconds',
    clock_offset_min: competitionClockOffsetMin(row.date, row.clockOffsetMin),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Whether a results push to Eventor is final. A runner never read out has no
 * result and is left out of the list (unread is not "not started", SOFT TA
 * till TR 7.8.2), so a list pushed while runners are still out is not
 * complete. Final only when the operator asks for it or nobody is left
 * without a read-out or a status; otherwise Provisional (Snapshot).
 */
export function pushResultStatus(state: CompetitionState, final?: boolean): ExportStatus {
  if (final === true) return 'Final';
  if (final === false) return 'Provisional';
  for (const c of state.competitors.values()) if (c.status === 'PEND') return 'Provisional';
  return 'Final';
}

export default async function registerEventorPushRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/competitions/:id/eventor/push-results
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { final?: unknown } | undefined }>(
    '/api/competitions/:id/eventor/push-results',
    async (req, reply) => {
      const { id } = req.params;
      const finalRaw = req.body?.final;
      if (finalRaw !== undefined && typeof finalRaw !== 'boolean') {
        return reply.code(400).send({ error: 'final_must_be_boolean' });
      }

      // Resolve API key.
      const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
      if (!apiKey) {
        return reply.code(400).send({ error: 'no_api_key' });
      }

      // Load competition.
      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .get() as CompetitionRow | undefined;
      if (!compRow) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      // Load classes.
      const classRows = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.competitionId, id))
        .all() as ClassRow[];

      // Build the ResultList from the projection, validated.
      const state = app.projectionStore.recomputeNow(id);
      if (state === null) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }
      const resultStatus = pushResultStatus(state, finalRaw as boolean | undefined);

      const built = await validateAndBuild({
        competition: competitionRowToDTO(compRow),
        classes: classRows.map((r) => ({
          id: r.id,
          competition_id: r.competitionId,
          name: r.name,
          short_name: r.shortName,
          no_timing: r.noTiming,
          start_method: r.startMethod,
          course_id: r.courseId,
        })),
        ...resultListInputs(app.fartolaDb, id),
        state,
        status: resultStatus,
      });
      if (!built.valid) {
        return reply.code(400).send({ error: 'xsd_invalid', errors: built.errors });
      }
      const { xml } = built.build;

      // Push to Eventor.
      try {
        const result = await pushToEventor({
          apiKey,
          xmlBody: xml,
          endpoint: 'import/resultlist',
        });
        return reply.code(200).send({ url: result.url, status: resultStatus });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: 'push_failed', message });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/competitions/:id/eventor/push-startlist
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/eventor/push-startlist',
    async (req, reply) => {
      const { id } = req.params;

      // Resolve API key.
      const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
      if (!apiKey) {
        return reply.code(400).send({ error: 'no_api_key' });
      }

      // Load competition.
      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .get() as CompetitionRow | undefined;
      if (!compRow) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      // Build StartList XML (pure, no XSD validation).
      const { xml } = buildStartListXml({
        competition: competitionRowToDTO(compRow),
        classes: startListClasses(app.fartolaDb, id),
      });

      // Push to Eventor.
      try {
        const result = await pushToEventor({
          apiKey,
          xmlBody: xml,
          endpoint: 'import/startlist',
        });
        return reply.code(200).send({ url: result.url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: 'push_failed', message });
      }
    }
  );
}
