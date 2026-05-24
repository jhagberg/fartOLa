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
// The route calls buildResultListXml / buildStartListXml (pure, no XSD
// validation) since Eventor does its own format validation server-side.
// XSD validation on the push path would double the latency for no benefit.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-08-PLAN.md task 1
// - D-11: POST /api/competitions/:id/eventor/push-results|push-startlist
// - D-12: pushToEventor sends PKZIP-archived IOF XML 3.0 with ApiKey header

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import {
  competitions,
  classes as classesTable,
  competitors as competitorsTable,
} from '../db/schema.ts';
import { resolveSecret } from '../config/secrets.ts';
import { pushToEventor } from '../eventor/push.ts';
import {
  buildResultListXml,
  buildStartListXml,
  type StartListCompetitor,
} from '../xml/iofExport.ts';
import type { CompetitionDTO } from '@fartola/shared-types';

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
    receipt_template: row.receiptTemplate as CompetitionDTO['receipt_template'],
    auto_print: row.autoPrint,
    created_at_ms: row.createdAtMs,
    race_started_at_ms: row.raceStartedAtMs,
    timing_format: row.timingFormat === 'tenths' ? 'tenths' : 'seconds',
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export default async function registerEventorPushRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/competitions/:id/eventor/push-results
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/eventor/push-results',
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

      // Load classes.
      const classRows = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.competitionId, id))
        .all() as ClassRow[];

      // Build ResultList XML from projection (pure, no XSD validation).
      const state = app.projectionStore.recomputeNow(id);
      if (state === null) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      const { xml } = buildResultListXml({
        competition: competitionRowToDTO(compRow),
        classes: classRows.map((r) => ({
          id: r.id,
          competition_id: r.competitionId,
          name: r.name,
          short_name: r.shortName,
        })),
        courses: [],
        state,
      });

      // Push to Eventor.
      try {
        const result = await pushToEventor({
          apiKey,
          xmlBody: xml,
          endpoint: 'import/resultlist',
        });
        return reply.code(200).send({ url: result.url });
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

      // Load classes.
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
        startTimeMs: number | null;
      }
      const competitorRows = app.fartolaDb.db
        .select({
          id: competitorsTable.id,
          name: competitorsTable.name,
          club: competitorsTable.club,
          classId: competitorsTable.classId,
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

      // Build StartList XML (pure, no XSD validation).
      const { xml } = buildStartListXml({
        competition: competitionRowToDTO(compRow),
        classes: classRows.map((cls) => ({
          name: cls.name,
          competitors: (byClass.get(cls.id) ?? []).map(
            (c): StartListCompetitor => ({
              name: c.name,
              club: c.club,
              startTimeMs: c.startTimeMs,
            })
          ),
        })),
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
