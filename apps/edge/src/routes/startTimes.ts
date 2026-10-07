// Authored for fartola. Not ported from upstream.
//
// Start-time history and undo (ADR-0016 rule 2: undo rather than "are you
// sure?"; ADR-0003: undo is a compensating event).
//
//   GET  /api/competitions/:id/start-times/history — the latest 50
//        start_times_set events, newest first, with what each changed and
//        whether it has been undone.
//   POST /api/competitions/:id/start-times/undo { node_id, local_seq } —
//        puts back the start times (and class grid) the event replaced, as a
//        new event with cause 'undo'. 409 start_changed_since when a runner's
//        start was changed again afterwards (undo that change first);
//        409 already_undone; 404 when there is no such event.

import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { competitors, events, type EventPayload } from '../db/schema.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { writeStartTimes } from '../db/startTimes.ts';

type StartTimesSet = Extract<EventPayload, { event_type: 'start_times_set' }>;

const UndoInput = z
  .object({ node_id: z.string().min(1), local_seq: z.number().int().positive() })
  .strict();

export default async function registerStartTimesRoutes(app: FastifyInstance): Promise<void> {
  const startEvents = (competitionId: string) =>
    app.fartolaDb.db
      .select()
      .from(events)
      .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'start_times_set')))
      .orderBy(desc(events.eventTimeMs), desc(events.localSeq))
      .all()
      .map((e) => ({ ...e, payload: e.payload as StartTimesSet }));

  app.get<{ Params: { id: string } }>('/api/competitions/:id/start-times/history', async (req) => {
    const all = startEvents(req.params.id);
    const undone = new Set(
      all.flatMap((e) =>
        e.payload.undoes ? [`${e.payload.undoes.node_id}:${e.payload.undoes.local_seq}`] : []
      )
    );
    return {
      items: all.slice(0, 50).map((e) => ({
        node_id: e.nodeId,
        local_seq: e.localSeq,
        at_ms: e.eventTimeMs,
        cause: e.payload.cause,
        class_id: e.payload.class_id,
        changed: e.payload.changes.length,
        undone: undone.has(`${e.nodeId}:${e.localSeq}`),
      })),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/start-times/undo',
    async (req, reply) => {
      const competitionId = req.params.id;
      const parsed = UndoInput.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
      const { node_id, local_seq } = parsed.data;
      const all = startEvents(competitionId);
      const target = all.find((e) => e.nodeId === node_id && e.localSeq === local_seq);
      if (!target) return reply.code(404).send({ error: 'start_times_event_not_found' });
      // The offset change that caused it stays; undoing the starts alone would
      // leave every start off by the shift.
      if (target.payload.cause === 'clock_shift')
        return reply.code(409).send({ error: 'clock_shift_not_undoable' });
      if (
        all.some(
          (e) => e.payload.undoes?.node_id === node_id && e.payload.undoes.local_seq === local_seq
        )
      )
        return reply.code(409).send({ error: 'already_undone' });

      // Only if every runner still has the start this event gave them.
      const now = new Map(
        app.fartolaDb.db
          .select({ id: competitors.id, startTimeMs: competitors.startTimeMs })
          .from(competitors)
          .where(eq(competitors.competitionId, competitionId))
          .all()
          .map((r) => [r.id, r.startTimeMs])
      );
      const moved = target.payload.changes
        .filter((c) => now.get(c.competitor_id) !== c.start_time_ms)
        .map((c) => c.competitor_id);
      if (moved.length > 0)
        return reply.code(409).send({ error: 'start_changed_since', competitor_ids: moved });

      const grid = target.payload.class_grid;
      const written = writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
        cause: 'undo',
        classId: target.payload.class_id,
        changes: target.payload.changes.map((c) => ({
          competitorId: c.competitor_id,
          startTimeMs: c.previous_ms,
        })),
        ...(grid !== undefined
          ? {
              classGrid: {
                firstStartMs: grid.previous_first_start_ms,
                intervalSec: grid.previous_interval_sec,
              },
            }
          : {}),
        undoes: { node_id, local_seq },
      });
      app.projectionStore.markDirty(competitionId);
      return reply
        .code(201)
        .send({ local_seq: written?.local_seq ?? null, changed: written?.changed ?? 0 });
    }
  );
}
