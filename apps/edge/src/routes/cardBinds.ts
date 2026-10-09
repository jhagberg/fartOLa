// Authored for fartola. Not ported from upstream.
//
// Card binds for an entered runner who reads out with a card the entry
// does not have (todo 2026-10-08-unknown-card-entered-runner).
//
//   POST /api/competitions/:id/card-binds/undo { node_id, local_seq } —
//        undoes a card replacement (POST /api/competitors replace mode,
//        which logs previous_card_number): the competitor gets the old card
//        back, as a new card_bound event (or card_unbound when there was no
//        old card) pointing at the one it undoes (ADR-0003: undo is a
//        compensating event; ADR-0016 rule 2). 404 no such bind;
//        409 not_undoable (a bind with no old card logged, or an undo);
//        409 already_undone; 409 card_changed_since when the competitor's
//        card was changed again (undo that first); 409 card_taken when
//        another competitor now holds the old card.
//
// Reads attach by the competitors' current card numbers, so after the undo
// the read made with the new card is an unknown card again.

import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { readoutChannel } from '@fartola/shared-types';
import { competitors, events, type EventPayload } from '../db/schema.ts';
import { issuesToErrors } from './_zod-errors.ts';

const UndoInput = z
  .object({ node_id: z.string().min(1), local_seq: z.number().int().positive() })
  .strict();

type CardBound = Extract<EventPayload, { event_type: 'card_bound' }>;

export default async function registerCardBindsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/card-binds/undo',
    async (req, reply) => {
      const competitionId = req.params.id;
      const parsed = UndoInput.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
      const { node_id, local_seq } = parsed.data;

      const binds = app.fartolaDb.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.competitionId, competitionId),
            inArray(events.eventType, ['card_bound', 'card_unbound'])
          )
        )
        .all();
      const target = binds.find(
        (e) => e.nodeId === node_id && e.localSeq === local_seq && e.eventType === 'card_bound'
      );
      if (!target) return reply.code(404).send({ error: 'card_bind_not_found' });
      const bind = target.payload as CardBound;
      if (bind.previous_card_number === undefined || bind.undoes !== undefined)
        return reply.code(409).send({ error: 'not_undoable' });
      const undoneBefore = binds.some((e) => {
        const u = (e.payload as { undoes?: { node_id: string; local_seq: number } }).undoes;
        return u?.node_id === node_id && u.local_seq === local_seq;
      });
      if (undoneBefore) return reply.code(409).send({ error: 'already_undone' });

      const row = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(
          and(eq(competitors.id, bind.competitor_id), eq(competitors.competitionId, competitionId))
        )
        .get();
      if (!row) return reply.code(404).send({ error: 'competitor_not_found' });
      if (row.cardNumber !== bind.card_number)
        return reply.code(409).send({ error: 'card_changed_since' });

      const previous = bind.previous_card_number;
      if (previous !== null) {
        const holder = app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(
            and(eq(competitors.competitionId, competitionId), eq(competitors.cardNumber, previous))
          )
          .get();
        if (holder && holder.id !== row.id)
          return reply.code(409).send({ error: 'card_taken', existing_competitor_id: holder.id });
      }

      const now = Date.now();
      const undoes = { node_id, local_seq };
      let seq = 0;
      app.fartolaDb.sqlite.transaction(() => {
        app.fartolaDb.db
          .update(competitors)
          .set({ cardNumber: previous })
          .where(eq(competitors.id, row.id))
          .run();
        seq = app.fartolaNextLocalSeq(app.fartolaDb, app.fartolaNodeId);
        const payload: EventPayload =
          previous === null
            ? {
                event_type: 'card_unbound',
                competitor_id: row.id,
                card_number: bind.card_number,
                undoes,
              }
            : {
                event_type: 'card_bound',
                competitor_id: row.id,
                card_number: previous,
                walkup: false,
                consent_at_ms: row.consentAtMs ?? now,
                previous_card_number: bind.card_number,
                undoes,
              };
        app.fartolaDb.db
          .insert(events)
          .values({
            nodeId: app.fartolaNodeId,
            localSeq: seq,
            competitionId,
            eventType: payload.event_type,
            eventTimeMs: now,
            recordedAtMs: now,
            payload,
          })
          .run();
      })();

      // The readout refetches competitors and reads on card_bound.
      app.wsBroadcast(readoutChannel(competitionId), {
        type: 'card_bound',
        payload: {
          competitor_id: row.id,
          card_number: previous,
          competition_id: competitionId,
          class_id: row.classId,
          name: row.name,
          club: row.club,
        },
        seq,
      });
      app.projectionStore.markDirty(competitionId);
      return reply.code(201).send({ competitor_id: row.id, card_number: previous, local_seq: seq });
    }
  );
}
