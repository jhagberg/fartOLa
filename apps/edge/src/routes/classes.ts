// Authored for fartola. Not ported from upstream.
//
// REST CRUD for classes — always nested under a competition (RESTful + matches
// UI-SPEC §Wizard: classes are created either by the wizard or by the XML
// import in plan 05). No standalone /api/classes route.
//
// Routes registered here:
//   - GET    /api/competitions/:id/classes  — list classes for a competition
//   - POST   /api/competitions/:id/classes  — create a class (used by plan 05 XML auto-create)
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-09
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §Wizard
//   (classes can be created later from XML import)

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { ClassCreateInput, ClassKind, StartMethod, type ClassDTO } from '@fartola/shared-types';
import { competitions, classes } from '../db/schema.ts';
import type { Class } from '../db/types.ts';
import { resolveSecret } from '../config/secrets.ts';
import { kindNeedsAge, suggestClassKind } from '../draw/classKind.ts';
import { fetchEventorClassTypes } from '../eventor/eventClasses.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { maxTimeLocked } from './_maxTime.ts';

const KindsInput = z
  .object({
    items: z
      .array(
        z
          .object({
            class_id: z.string().min(1),
            class_kind: ClassKind,
            age_class: z.number().int().positive().nullable(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

// Phase 2.1 D-08: PATCH class route for maxTimeSec editing — a per-class
// max time, used only when the competition has none (SOFT TR 4.21.1 wants
// one value for all classes, so it is for non-sanctioned use).
// Backend ownership here (consumed by Plan 05 UI).
// 02.1-14 Task 9: also no_timing (snake_case like the ClassDTO field), and
// Task 14 start_method. Each field is optional; only the fields sent are
// updated.
const PatchClassInput = z
  .object({
    maxTimeSec: z.number().int().positive().nullable().optional(),
    no_timing: z.boolean().optional(),
    start_method: StartMethod.optional(),
  })
  .strict()
  .refine(
    (b) => b.maxTimeSec !== undefined || b.no_timing !== undefined || b.start_method !== undefined,
    { message: 'maxTimeSec, no_timing or start_method required' }
  );

/** The kind a new class gets: the operator's when given, else the SOFT-name
 * suggestion, else none. */
function kindOnCreate(input: {
  name: string;
  class_kind?: ClassKind | undefined;
  age_class?: number | null | undefined;
}): Pick<Class, 'classKind' | 'ageClass' | 'classKindSource'> {
  if (input.class_kind !== undefined)
    return {
      classKind: input.class_kind,
      // The name's age is kept when the operator gives none.
      ageClass: input.age_class ?? suggestClassKind(input.name)?.ageClass ?? null,
      classKindSource: 'operator',
    };
  const s = suggestClassKind(input.name);
  return s === null
    ? { classKind: null, ageClass: null, classKindSource: null }
    : { classKind: s.kind, ageClass: s.ageClass, classKindSource: 'name' };
}

function classRowToDTO(row: Class): ClassDTO {
  return {
    id: row.id,
    competition_id: row.competitionId,
    name: row.name,
    short_name: row.shortName,
    no_timing: row.noTiming,
    start_method: row.startMethod,
    class_kind: row.classKind,
    age_class: row.ageClass,
    class_kind_source: row.classKindSource,
  };
}

export default async function registerClasses(app: FastifyInstance): Promise<void> {
  // GET /api/competitions/:id/classes — list classes for a competition.
  app.get<{ Params: { id: string } }>('/api/competitions/:id/classes', async (req, reply) => {
    const { id } = req.params;
    // 404 if the competition doesn't exist — keeps the response contract
    // self-consistent (callers see 404 for an unknown parent).
    const compRow = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!compRow) return reply.code(404).send({ error: 'competition not found' });

    const rows = app.fartolaDb.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, id))
      .orderBy(asc(classes.name))
      .all();
    return { classes: rows.map(classRowToDTO) };
  });

  // PATCH /api/competitions/:id/classes/:classId — update class settings.
  // Phase 2.1 D-08: maxTimeSec for the class time cap.
  // T-02.1 cross-competition pre-flight: verify class belongs to competition → 404.
  app.patch<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/classes/:classId',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;

      const parsed = PatchClassInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }

      // Cross-competition pre-flight.
      const classRow = app.fartolaDb.db
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, classId), eq(classes.competitionId, competitionId)))
        .get();
      if (!classRow) {
        return reply.code(404).send({ error: 'class_not_found' });
      }

      const { maxTimeSec, no_timing, start_method } = parsed.data;
      // SOFT TR 4.21.2: no max time change after the first start.
      if (maxTimeSec !== undefined && maxTimeLocked(app.fartolaDb, competitionId, Date.now())) {
        const current = app.fartolaDb.db
          .select({ maxTimeSec: classes.maxTimeSec })
          .from(classes)
          .where(eq(classes.id, classId))
          .get();
        if (current?.maxTimeSec !== maxTimeSec) {
          return reply.code(409).send({ error: 'max_time_locked' });
        }
      }
      app.fartolaDb.db
        .update(classes)
        .set({
          ...(maxTimeSec !== undefined ? { maxTimeSec } : {}),
          ...(no_timing !== undefined ? { noTiming: no_timing } : {}),
          ...(start_method !== undefined ? { startMethod: start_method } : {}),
        })
        .where(eq(classes.id, classId))
        .run();

      app.projectionStore.markDirty(competitionId);

      return reply.code(200).send({ ok: true });
    }
  );

  // POST /api/competitions/:id/classes — create a class.
  app.post<{ Params: { id: string } }>('/api/competitions/:id/classes', async (req, reply) => {
    const { id } = req.params;
    const parsed = ClassCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const compRow = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!compRow) return reply.code(404).send({ error: 'competition not found' });

    const kind = kindOnCreate(parsed.data);
    if (kind.classKind !== null && kindNeedsAge(kind.classKind) && kind.ageClass === null)
      return reply.code(400).send({ error: 'age_class_required' });
    const row: Class = {
      id: crypto.randomUUID(),
      competitionId: id,
      name: parsed.data.name,
      shortName: parsed.data.short_name ?? null,
      // Phase 2.1 D-05/D-08: new nullable columns; null on creation.
      firstStartMs: null,
      startIntervalSec: null,
      maxTimeSec: null,
      // 02.1-14 Task 4: assigned by course import / course creation.
      courseId: null,
      noTiming: false,
      startMethod: 'auto',
      bibPrefix: null,
      bibBase: null,
      startName: null,
      ...kind,
    };
    app.fartolaDb.db.insert(classes).values(row).run();
    return reply.code(201).send(classRowToDTO(row));
  });

  /** Eventor's ClassTypeId per class name for the linked event. */
  const eventorTypes = async (eventorEventId: number | null) => {
    let types = new Map<string, number>();
    let eventor: 'used' | 'not_linked' | 'no_key' | 'failed' = 'not_linked';
    if (eventorEventId !== null) {
      const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
      if (!apiKey) eventor = 'no_key';
      else
        try {
          types = await fetchEventorClassTypes({ apiKey, eventId: eventorEventId });
          eventor = 'used';
        } catch (e) {
          app.log.warn({ err: (e as Error).message }, 'eventor eventclasses fetch failed');
          eventor = 'failed';
        }
    }
    return { types, eventor };
  };

  // GET /api/competitions/:id/classes/kinds — the class kind of every class
  // and a suggestion for it (SOFT TR 3.4.2): Eventor's ClassTypeId when the
  // competition is linked to an Eventor event and an API key is set, else
  // the SOFT name pattern. Writes nothing; the operator confirms with PUT.
  // `eventor`: 'used' | 'not_linked' | 'no_key' | 'failed'.
  app.get<{ Params: { id: string } }>('/api/competitions/:id/classes/kinds', async (req, reply) => {
    const comp = app.fartolaDb.db
      .select({ eventorEventId: competitions.eventorEventId })
      .from(competitions)
      .where(eq(competitions.id, req.params.id))
      .get();
    if (!comp) return reply.code(404).send({ error: 'competition not found' });
    const { types, eventor } = await eventorTypes(comp.eventorEventId);
    const rows = app.fartolaDb.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, req.params.id))
      .orderBy(asc(classes.name))
      .all();
    return {
      eventor,
      items: rows.map((r) => {
        const s = suggestClassKind(r.name, types.get(r.name) ?? null);
        return {
          class_id: r.id,
          name: r.name,
          class_kind: r.classKind,
          age_class: r.ageClass,
          class_kind_source: r.classKindSource,
          suggestion:
            s === null ? null : { class_kind: s.kind, age_class: s.ageClass, source: s.source },
        };
      }),
    };
  });

  // POST /api/competitions/:id/classes/kinds/from-eventor — sets the kind of
  // every class Eventor classifies (ClassTypeId 17 / 19) with source
  // 'eventor', which counts as confirmed. A kind the operator chose stays.
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/classes/kinds/from-eventor',
    async (req, reply) => {
      const comp = app.fartolaDb.db
        .select({ eventorEventId: competitions.eventorEventId })
        .from(competitions)
        .where(eq(competitions.id, req.params.id))
        .get();
      if (!comp) return reply.code(404).send({ error: 'competition not found' });
      const { types, eventor } = await eventorTypes(comp.eventorEventId);
      if (eventor !== 'used')
        return reply.code(409).send({ error: 'eventor_unavailable', eventor });
      const rows = app.fartolaDb.db
        .select()
        .from(classes)
        .where(eq(classes.competitionId, req.params.id))
        .all();
      let updated = 0;
      app.fartolaDb.sqlite.transaction(() => {
        for (const r of rows) {
          if (r.classKindSource === 'operator') continue;
          const s = suggestClassKind(r.name, types.get(r.name) ?? null);
          if (s === null || s.source !== 'eventor') continue;
          app.fartolaDb.db
            .update(classes)
            .set({ classKind: s.kind, ageClass: s.ageClass, classKindSource: 'eventor' })
            .where(eq(classes.id, r.id))
            .run();
          updated++;
        }
      })();
      return { updated };
    }
  );

  // PUT /api/competitions/:id/classes/kinds — the operator confirms or
  // changes class kinds (source 'operator'). All or nothing: an id outside
  // the competition → 400 and nothing is written.
  app.put<{ Params: { id: string } }>('/api/competitions/:id/classes/kinds', async (req, reply) => {
    const parsed = KindsInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
    const ids = parsed.data.items.map((i) => i.class_id);
    const known = new Set(
      app.fartolaDb.db
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.competitionId, req.params.id), inArray(classes.id, ids)))
        .all()
        .map((r) => r.id)
    );
    const unknown = ids.find((id) => !known.has(id));
    if (unknown !== undefined)
      return reply.code(400).send({ error: 'class_not_in_competition', class_id: unknown });
    // An age class needs its age: from the item, else from the class name.
    const names = new Map(
      app.fartolaDb.db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(inArray(classes.id, ids))
        .all()
        .map((r) => [r.id, r.name])
    );
    const items = parsed.data.items.map((i) => ({
      ...i,
      age_class: i.age_class ?? suggestClassKind(names.get(i.class_id) ?? '')?.ageClass ?? null,
    }));
    const noAge = items.find((i) => kindNeedsAge(i.class_kind) && i.age_class === null);
    if (noAge !== undefined)
      return reply.code(400).send({ error: 'age_class_required', class_id: noAge.class_id });
    app.fartolaDb.sqlite.transaction(() => {
      for (const i of items)
        app.fartolaDb.db
          .update(classes)
          .set({ classKind: i.class_kind, ageClass: i.age_class, classKindSource: 'operator' })
          .where(eq(classes.id, i.class_id))
          .run();
    })();
    return { updated: items.length };
  });
}
