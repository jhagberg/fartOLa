// Authored for fartola. Not ported from upstream.
//
// REST handler: `POST /api/competitions/:id/print-receipt`. Resolves the
// competitor + competition + class + course + projection (via
// app.projectionStore.get / recomputeNow) + place context, builds the
// PrintEnvelope, and dispatches to app.printerSink. Maps single-flight
// queue / printer errors to HTTP status codes:
//
//   201 { queued: true, queue_position: number }   — success
//   404 { error: 'competitor_not_found' }
//   404 { error: 'competition_not_found' }
//   429 { error: 'queue_full' }
//   503 { error: 'printer_offline' | 'paper_out' | 'print_failed', detail }
//
// W-3 contract: for template === 'kids', populate `data.skogisStats` at
// the envelope-construction site (NOT inside the template). The kids
// template reads from data.skogisStats directly.
//
// PATTERNS S-6: snake_case at the I/O boundary — the request body uses
// snake_case (competitor_id, template) and the response uses snake_case
// (queued, queue_position, error).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-15-PLAN.md task 1

import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  competitions,
  competitors as competitorsTable,
  classes as classesTable,
  courses,
  courseControls,
  controls as controlsTable,
} from '../db/schema.ts';
import type {
  PrintEnvelope,
  ReceiptData,
  ReceiptTemplate,
  PrintCompetition,
  PrintClass,
  PrintCourse,
  PrintPlaceContext,
} from '../print/sink.ts';
import { loadVoidedControlCodes } from '../projection/loader.ts';
import { skogisFromInput } from '@fartola/shared-types';
import { issuesToErrors } from './_zod-errors.ts';

const TEMPLATE_VALUES = ['classic', 'standing', 'detailed', 'top4', 'minimal', 'kids'] as const;

const PrintRequestSchema = z.object({
  competitor_id: z.string().min(1),
  template: z.enum(TEMPLATE_VALUES).optional(),
});

interface PrintRouteOpts {
  /** Test-only override of the resolver that turns the route into a fake
   * queue length. Production uses the live app.printerSink.print()
   * promise resolution. */
  queuePositionHint?: () => number;
}

export default async function registerPrintRoute(
  app: FastifyInstance,
  opts: PrintRouteOpts = {}
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/print-receipt',
    async (req, reply) => {
      const { id: competitionId } = req.params;
      const parsed = PrintRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const { competitor_id, template: bodyTemplate } = parsed.data;

      const compRow = app.fartolaDb.db
        .select()
        .from(competitions)
        .where(eq(competitions.id, competitionId))
        .get();
      if (!compRow) return reply.code(404).send({ error: 'competition_not_found' });

      const competitorRow = app.fartolaDb.db
        .select()
        .from(competitorsTable)
        .where(
          and(
            eq(competitorsTable.id, competitor_id),
            eq(competitorsTable.competitionId, competitionId)
          )
        )
        .get();
      if (!competitorRow) return reply.code(404).send({ error: 'competitor_not_found' });

      const classRow = app.fartolaDb.db
        .select()
        .from(classesTable)
        .where(eq(classesTable.id, competitorRow.classId))
        .get();
      if (!classRow) return reply.code(404).send({ error: 'class_not_found' });

      // Course: the class's course_id (02.1-14 Task 4), else the legacy
      // course whose class_id matches; null if none.
      const courseRow = app.fartolaDb.db
        .select()
        .from(courses)
        .where(
          classRow.courseId !== null
            ? eq(courses.id, classRow.courseId)
            : and(eq(courses.competitionId, competitionId), eq(courses.classId, classRow.id))
        )
        .get();
      // Control codes (ordered) for the course, when one exists.
      const controlCodes: number[] = [];
      if (courseRow) {
        const rows = app.fartolaDb.db
          .select({ code: controlsTable.code, idx: courseControls.orderIdx })
          .from(courseControls)
          .innerJoin(controlsTable, eq(controlsTable.id, courseControls.controlId))
          .where(eq(courseControls.courseId, courseRow.id))
          .orderBy(asc(courseControls.orderIdx))
          .all();
        for (const r of rows) controlCodes.push(r.code);
      }

      // Projection: always recompute synchronously before reading state
      // (C-M2 discipline, matches auto-print path in bridge.ts). A
      // card_read landing during the markDirty debounce window would
      // otherwise render the receipt from stale projection state.
      // recomputeNow returns null only if the competition row vanished
      // mid-request — treat as 404.
      const state = app.projectionStore.recomputeNow(competitionId);
      if (state === null) return reply.code(404).send({ error: 'competition_not_found' });
      const view = state.competitors.get(competitor_id);
      if (!view) return reply.code(404).send({ error: 'competitor_not_found' });
      const classRows = state.results_by_class.get(classRow.id) ?? [];
      const selfRow = classRows.find((r) => r.competitor_id === competitor_id);
      const leaderRow = classRows.find((r) => r.place === 1);

      const template: ReceiptTemplate =
        bodyTemplate ?? (compRow.receiptTemplate as ReceiptTemplate);

      const printCompetition: PrintCompetition = {
        id: compRow.id,
        name: compRow.name,
        date: compRow.date,
        receipt_template: compRow.receiptTemplate as ReceiptTemplate,
        auto_print: compRow.autoPrint,
      };
      const printClass: PrintClass = { id: classRow.id, name: classRow.name };
      const printCourse: PrintCourse = courseRow
        ? {
            id: courseRow.id,
            name: courseRow.name,
            length_m: courseRow.lengthM,
            climb_m: courseRow.climbM,
            control_codes: controlCodes,
            voided_codes: loadVoidedControlCodes(app.fartolaDb, competitionId),
          }
        : {
            id: '',
            name: '',
            length_m: null,
            climb_m: null,
            control_codes: [],
          };
      const placeContext: PrintPlaceContext = {
        place: selfRow?.place ?? null,
        behind_leader_ms: selfRow?.behind_leader_ms ?? null,
        leader_name: leaderRow?.name ?? null,
        class_rows: classRows,
      };

      // W-3: populate skogisStats at construction time for kids templates.
      // generateSkogis is called HERE, never inside the template, so the
      // template stays a pure renderer + the test can assert determinism
      // by inspecting the envelope.
      let skogisStats: ReceiptData['skogisStats'] | undefined;
      if (template === 'kids') {
        const skogis = skogisFromInput({
          cardNumber: view.card_number ?? 0,
          name: view.name,
          club: view.club,
          classId: view.class_id,
          status: view.status,
          place: selfRow?.place ?? null,
          controlCount: view.latest_punches.length,
          bestLegs: 0,
          totalLegs: Math.max(1, view.latest_punches.length),
          startersInClass: Math.max(1, classRows.length),
        });
        skogisStats = skogis.stats;
      }

      const data: ReceiptData = {
        competitor: view,
        competition: printCompetition,
        classObj: printClass,
        course: printCourse,
        placeContext,
        ...(skogisStats !== undefined ? { skogisStats } : {}),
      };
      const envelope: PrintEnvelope = {
        template,
        competition_id: competitionId,
        card_number: view.card_number ?? 0,
        data,
      };

      try {
        await app.printerSink.print(envelope);
        return reply
          .code(201)
          .send({ queued: true, queue_position: opts.queuePositionHint?.() ?? 0 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'queue_full') {
          return reply.code(429).send({ error: 'queue_full' });
        }
        if (msg === 'printer_offline' || msg === 'paper_out') {
          return reply.code(503).send({ error: msg, detail: msg });
        }
        return reply.code(503).send({ error: 'print_failed', detail: msg });
      }
    }
  );
}
