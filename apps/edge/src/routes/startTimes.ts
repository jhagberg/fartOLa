// Authored for fartola. Not ported from upstream.
//
// Start-time history and undo (ADR-0016 rule 2: undo rather than "are you
// sure?"; ADR-0003: undo is a compensating event).
//
//   GET  /api/competitions/:id/start-times/history — the latest 50
//        start_times_set events, newest first, with what each changed and
//        whether it has been undone.
//   POST /api/competitions/:id/start-times/undo { node_id, local_seq } —
//        puts back the start times (and class grids) the event replaced, as a
//        new event with cause 'undo'. 409 start_changed_since when a runner's
//        start was changed again afterwards (undo that change first);
//        409 already_undone; 404 when there is no such event.
//        A start-list import also changed card numbers and bibs; its event
//        records them (card_changes, bib_changes) and the undo puts them
//        back from that record, whole or nothing: 409 card_changed_since /
//        bib_changed_since when a runner no longer has what the import
//        gave, 409 card_taken / bib_taken when another runner has the old
//        one now, and 409 has_result when a runner has read out with the
//        card the import gave, since the import (routes/_cardResult.ts: the
//        result stays; a read-out the import itself attached goes back to
//        being an unknown card).
//        Each of them lists competitor_ids.

import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { classes, competitors, events, type EventPayload } from '../db/schema.ts';
import { readsOnCard } from './_cardResult.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { gridsOf, writeStartTimes } from '../db/startTimes.ts';

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
      .orderBy(desc(events.localSeq), desc(events.nodeId))
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
        cards: e.payload.card_changes?.length ?? 0,
        bibs: e.payload.bib_changes?.length ?? 0,
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
      const rows = app.fartolaDb.db
        .select({
          id: competitors.id,
          startTimeMs: competitors.startTimeMs,
          cardNumber: competitors.cardNumber,
          bib: competitors.bib,
        })
        .from(competitors)
        .where(eq(competitors.competitionId, competitionId))
        .all();
      const now = new Map(rows.map((r) => [r.id, r.startTimeMs]));
      const moved = target.payload.changes
        .filter((c) => now.get(c.competitor_id) !== c.start_time_ms)
        .map((c) => c.competitor_id);
      if (moved.length > 0)
        return reply.code(409).send({ error: 'start_changed_since', competitor_ids: moved });

      // The same for the cards and bibs an import changed, and the old ones
      // must be free: held by nobody, or by a runner this undo moves off it.
      const cards = target.payload.card_changes ?? [];
      const bibs = target.payload.bib_changes ?? [];
      const rowOf = new Map(rows.map((r) => [r.id, r]));
      const inCards = new Set(cards.map((c) => c.competitor_id));
      const inBibs = new Set(bibs.map((b) => b.competitor_id));
      // No await from here to the write: the reads counted are the reads
      // there are when the cards move.
      const refusals: Array<[string, ReadonlyArray<{ competitor_id: string }>]> = [
        [
          'card_changed_since',
          cards.filter((c) => rowOf.get(c.competitor_id)?.cardNumber !== c.card_number),
        ],
        ['bib_changed_since', bibs.filter((b) => rowOf.get(b.competitor_id)?.bib !== b.bib)],
        [
          'has_result',
          cards.filter(
            (c) => readsOnCard(app.fartolaDb, competitionId, c.card_number, c.local_seq) > 0
          ),
        ],
        [
          'card_taken',
          cards.filter(
            (c) =>
              c.previous_card_number !== null &&
              rows.some((r) => r.cardNumber === c.previous_card_number && !inCards.has(r.id))
          ),
        ],
        [
          'bib_taken',
          bibs.filter(
            (b) =>
              b.previous_bib !== null &&
              rows.some((r) => r.bib === b.previous_bib && !inBibs.has(r.id))
          ),
        ],
      ];
      const refusal = refusals.find(([, runners]) => runners.length > 0);
      if (refusal !== undefined)
        return reply
          .code(409)
          .send({ error: refusal[0], competitor_ids: refusal[1].map((r) => r.competitor_id) });

      // Every class grid the event set must still be the one it set: a
      // later draw, late-entrant placement or import changed it otherwise,
      // and undo would overwrite that decision.
      const grids = gridsOf(target.payload);
      for (const g of grids) {
        const cur = app.fartolaDb.db
          .select({ first: classes.firstStartMs, interval: classes.startIntervalSec })
          .from(classes)
          .where(eq(classes.id, g.class_id))
          .get();
        if (
          cur !== undefined &&
          (cur.first !== g.first_start_ms || cur.interval !== g.interval_sec)
        )
          return reply.code(409).send({ error: 'grid_changed_since' });
      }
      const written = writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
        cause: 'undo',
        classId: target.payload.class_id,
        changes: target.payload.changes.map((c) => ({
          competitorId: c.competitor_id,
          startTimeMs: c.previous_ms,
        })),
        classGrids: grids.map((g) => ({
          classId: g.class_id,
          firstStartMs: g.previous_first_start_ms,
          intervalSec: g.previous_interval_sec,
        })),
        undoes: { node_id, local_seq },
        // Backwards: the way the cards were changed, taken in reverse, never
        // gives two runners one card.
        cardChanges: cards.toReversed().map((c) => {
          const undoes = { node_id: target.nodeId, local_seq: c.local_seq };
          return c.previous_card_number === null
            ? { competitorId: c.competitor_id, cardNumber: null, undoes }
            : { competitorId: c.competitor_id, cardNumber: c.previous_card_number, undoes };
        }),
        bibChanges: bibs.map((b) => ({ competitorId: b.competitor_id, bib: b.previous_bib })),
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({
        local_seq: written?.local_seq ?? null,
        changed: written?.changed ?? 0,
        cards: written?.cards ?? 0,
        bibs: written?.bibs ?? 0,
      });
    }
  );
}
