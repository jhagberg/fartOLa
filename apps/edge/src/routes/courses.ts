// Authored for fartola. Not ported from upstream.
//
// REST CRUD for courses — always nested under a competition. Controls are
// embedded as `{ control_code, order_idx }` pairs at the wire boundary; the
// route maps codes → control rows (auto-creating missing controls in the
// same transaction) and writes the course_controls join.
//
// Routes registered here:
//   - GET    /api/competitions/:id/courses  — list courses with embedded controls
//   - POST   /api/competitions/:id/courses  — create course + (auto-)controls + course_controls atomically
//   - GET    /api/competitions/:id/voided-controls        — codes voided course-wide
//   - POST   /api/competitions/:id/voided-controls/:code  — void a control (02.1-14 Task 5)
//   - DELETE /api/competitions/:id/voided-controls/:code  — unvoid it
//
// The control auto-create behaviour mirrors the XML import path (plan 05):
// IOF CourseData / Purple Pen rarely names the controls explicitly, so the
// route either reuses an existing control row for the (competition_id, code)
// pair or inserts a fresh one. Plan 05 will share this helper when it
// dispatches CourseData.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-09 D-03
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §Wizard

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { asc, eq, and, inArray } from 'drizzle-orm';

import { CourseCreateInput, type CourseDTO, type CourseControlDTO } from '@fartola/shared-types';
import { competitions, courses, courseControls, controls, classes, events } from '../db/schema.ts';
import { voidedControlCodes } from '../projection/reduce.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { issuesToErrors } from './_zod-errors.ts';

export default async function registerCourses(app: FastifyInstance): Promise<void> {
  // GET /api/competitions/:id/courses — list with embedded controls.
  app.get<{ Params: { id: string } }>('/api/competitions/:id/courses', async (req, reply) => {
    const { id } = req.params;
    const compRow = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!compRow) return reply.code(404).send({ error: 'competition not found' });

    const courseRows = app.fartolaDb.db
      .select()
      .from(courses)
      .where(eq(courses.competitionId, id))
      .orderBy(asc(courses.name))
      .all();

    const controlsByCourse = new Map<string, CourseControlDTO[]>();
    for (const c of courseRows) controlsByCourse.set(c.id, []);
    if (courseRows.length > 0) {
      const joined = app.fartolaDb.db
        .select({
          courseId: courseControls.courseId,
          orderIdx: courseControls.orderIdx,
          code: controls.code,
        })
        .from(courseControls)
        .innerJoin(controls, eq(courseControls.controlId, controls.id))
        .where(eq(controls.competitionId, id))
        .orderBy(asc(courseControls.courseId), asc(courseControls.orderIdx))
        .all();
      for (const row of joined) {
        const arr = controlsByCourse.get(row.courseId);
        if (arr) arr.push({ control_code: row.code, order_idx: row.orderIdx });
      }
    }

    const courseDTOs: CourseDTO[] = courseRows.map((c) => ({
      id: c.id,
      competition_id: c.competitionId,
      name: c.name,
      class_id: c.classId,
      length_m: c.lengthM,
      climb_m: c.climbM,
      controls: controlsByCourse.get(c.id) ?? [],
    }));
    return { courses: courseDTOs };
  });

  // POST /api/competitions/:id/courses — create course + auto-controls + course_controls.
  app.post<{ Params: { id: string } }>('/api/competitions/:id/courses', async (req, reply) => {
    const { id: competitionId } = req.params;
    const parsed = CourseCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const existing = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!existing) return reply.code(404).send({ error: 'competition not found' });

    // WR-003: If a class_id is supplied, it must belong to THIS competition.
    // Without this guard, a course under competition A could reference a
    // class from competition B, which the projection layer indexes by classId
    // and would misattach/hide course controls in multi-competition databases.
    if (parsed.data.class_id != null) {
      const classRow = app.fartolaDb.db
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, parsed.data.class_id), eq(classes.competitionId, competitionId)))
        .get();
      if (!classRow) {
        return reply.code(422).send({
          errors: [
            {
              path: 'class_id',
              code: 'cross_competition',
              message: 'class_id does not belong to this competition',
            },
          ],
        });
      }
    }

    const courseId = crypto.randomUUID();
    const ccRowsToInsert: { id: string; courseId: string; controlId: string; orderIdx: number }[] =
      [];

    app.fartolaDb.sqlite.transaction(() => {
      // Insert the course row.
      app.fartolaDb.db
        .insert(courses)
        .values({
          id: courseId,
          competitionId,
          name: parsed.data.name,
          classId: parsed.data.class_id ?? null,
          lengthM: parsed.data.length_m ?? null,
          climbM: parsed.data.climb_m ?? null,
        })
        .run();
      // 02.1-14 Task 4: classes point at courses; courses.class_id above is
      // kept for back-compat only.
      if (parsed.data.class_id != null) {
        app.fartolaDb.db
          .update(classes)
          .set({ courseId })
          .where(eq(classes.id, parsed.data.class_id))
          .run();
      }

      // Bulk-select existing controls for this competition matching any of
      // the codes we need; bulk-insert anything missing.
      const wantedCodes = Array.from(new Set(parsed.data.controls.map((c) => c.control_code)));
      const existingControls = wantedCodes.length
        ? app.fartolaDb.db
            .select()
            .from(controls)
            .where(
              and(eq(controls.competitionId, competitionId), inArray(controls.code, wantedCodes))
            )
            .all()
        : [];
      const codeToControlId = new Map<number, string>();
      for (const c of existingControls) codeToControlId.set(c.code, c.id);
      const newControlRows: { id: string; competitionId: string; code: number }[] = [];
      for (const code of wantedCodes) {
        if (!codeToControlId.has(code)) {
          const newId = crypto.randomUUID();
          codeToControlId.set(code, newId);
          newControlRows.push({ id: newId, competitionId, code });
        }
      }
      if (newControlRows.length > 0) {
        app.fartolaDb.db.insert(controls).values(newControlRows).run();
      }

      // Build the course_controls rows in the requested order.
      for (const cc of parsed.data.controls) {
        const controlId = codeToControlId.get(cc.control_code);
        // codeToControlId is guaranteed to have every requested code at
        // this point — we just inserted any missing ones.
        if (!controlId) continue;
        ccRowsToInsert.push({
          id: crypto.randomUUID(),
          courseId,
          controlId,
          orderIdx: cc.order_idx,
        });
      }
      if (ccRowsToInsert.length > 0) {
        app.fartolaDb.db.insert(courseControls).values(ccRowsToInsert).run();
      }
    })();

    // Echo the created row as a CourseDTO with the controls list in order.
    const sortedControls: CourseControlDTO[] = [...parsed.data.controls]
      .sort((a, b) => a.order_idx - b.order_idx)
      .map((c) => ({ control_code: c.control_code, order_idx: c.order_idx }));
    const dto: CourseDTO = {
      id: courseId,
      competition_id: competitionId,
      name: parsed.data.name,
      class_id: parsed.data.class_id ?? null,
      length_m: parsed.data.length_m ?? null,
      climb_m: parsed.data.climb_m ?? null,
      controls: sortedControls,
    };
    return reply.code(201).send(dto);
  });

  // 02.1-14 Task 5 — course-wide voided controls. The state lives in the
  // event log (control_voided / control_unvoided) so the reducer replays it;
  // the operator write gate in server.ts covers POST/DELETE here.
  const competitionExists = (id: string): boolean =>
    app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get() !== undefined;

  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/voided-controls',
    async (req, reply) => {
      const { id } = req.params;
      if (!competitionExists(id)) return reply.code(404).send({ error: 'competition not found' });
      const rows = app.fartolaDb.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.competitionId, id),
            inArray(events.eventType, ['control_voided', 'control_unvoided'])
          )
        )
        .orderBy(asc(events.eventTimeMs), asc(events.localSeq))
        .all();
      return { control_codes: [...voidedControlCodes(rows, id)].sort((a, b) => a - b) };
    }
  );

  for (const [method, eventType] of [
    ['POST', 'control_voided'],
    ['DELETE', 'control_unvoided'],
  ] as const) {
    app.route<{ Params: { id: string; code: string } }>({
      method,
      url: '/api/competitions/:id/voided-controls/:code',
      handler: async (req, reply) => {
        const { id: competitionId, code: rawCode } = req.params;
        const code = Number(rawCode);
        if (!/^\d+$/.test(rawCode) || !Number.isSafeInteger(code) || code <= 0) {
          return reply.code(400).send({
            errors: [{ path: 'code', code: 'invalid', message: 'code must be a positive integer' }],
          });
        }
        if (!competitionExists(competitionId)) {
          return reply.code(404).send({ error: 'competition not found' });
        }
        const r = insertEvent(
          app.fartolaDb,
          app.fartolaNodeId,
          eventType,
          Date.now(),
          { event_type: eventType, control_code: code },
          competitionId
        );
        app.projectionStore.markDirty(competitionId);
        return reply.code(201).send({ local_seq: r.local_seq });
      },
    });
  }
}
