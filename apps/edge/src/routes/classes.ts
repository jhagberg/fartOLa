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
import { asc, eq } from 'drizzle-orm';

import { ClassCreateInput, type ClassDTO } from '@fartola/shared-types';
import { competitions, classes } from '../db/schema.ts';
import type { Class } from '../db/types.ts';
import { issuesToErrors } from './_zod-errors.ts';

function classRowToDTO(row: Class): ClassDTO {
  return {
    id: row.id,
    competition_id: row.competitionId,
    name: row.name,
    short_name: row.shortName,
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

    const row: Class = {
      id: crypto.randomUUID(),
      competitionId: id,
      name: parsed.data.name,
      shortName: parsed.data.short_name ?? null,
      // Phase 2.1 D-05/D-08: new nullable columns; null on creation.
      firstStartMs: null,
      startIntervalSec: null,
      maxTimeSec: null,
    };
    app.fartolaDb.db.insert(classes).values(row).run();
    return reply.code(201).send(classRowToDTO(row));
  });
}
