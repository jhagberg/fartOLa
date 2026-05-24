// Authored for fartola. Not ported from upstream.
//
// REST handler for the check-unit backup readout snapshot:
//
//   POST /api/competitions/:id/checkunit/snapshot[?reader=<position>]
//
// The route reads the BSF8 check-unit backup memory via the currently
// connected SI bridge. It returns the card numbers that checked in through
// the start check unit, together with the set of card numbers that have
// physically returned (card_read event with a non-null finish punch).
//
// Response shape:
//   {
//     cardNumbers: number[],    // SI card numbers from backup memory
//     returnedCardNumbers: number[], // cards with a finish punch in events
//     overflow: boolean,        // backup memory wrapped around
//     readCount: number,        // length of cardNumbers
//   }
//
// Error responses:
//   404  { error: 'competition_not_found' }
//   503  { error: 'no_reader', message: string }      — no bridge connected
//   500  { error: 'snapshot_failed', message: string } — serial error
//
// Reader selection: optional `?reader=<position>` query param picks which
// lifecycle to use (matches `lifecycle.status().position`). When absent,
// the first available connected reader is used. The position matching is
// case-sensitive (values are operator-defined labels like 'left', 'right').
//
// Finish-punch detection: a runner is "returned" ONLY when their SI card
// has been physically read at the finish station — specifically when the
// most recent card_read event for that card_number in this competition
// carries a non-null `finish` field in the payload. Computed statuses
// (OK/MP/DNF/DQ/MAX) are NOT used; manual overrides cannot substitute
// for a physical finish read. (GPT+Gemini HIGH review concern resolved.)
//
// T-02.1-11 (DoS): readBackupMemory already caps iteration at MAX_ITERATIONS;
// this route adds no additional loop risk.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-06-PLAN.md task 2
// - REQ-OPS-004

import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';

import { competitions, events } from '../db/schema.ts';
import { readBackupMemory } from '@fartola/sportident';
import type { EventPayload } from '../db/schema.ts';

export default async function registerCheckunitRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/checkunit/snapshot
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Querystring: { reader?: string } }>(
    '/api/competitions/:id/checkunit/snapshot',
    async (req, reply) => {
      const { id } = req.params;
      const readerPosition = req.query.reader ?? null;

      // Verify competition exists.
      const compRow = app.fartolaDb.db
        .select({ id: competitions.id })
        .from(competitions)
        .where(eq(competitions.id, id))
        .get();
      if (!compRow) {
        return reply.code(404).send({ error: 'competition_not_found' });
      }

      // Select the appropriate bridge lifecycle.
      const lifecycles = app.bridgeLifecycles;
      let lifecycle: (typeof lifecycles)[number] | undefined;
      if (readerPosition !== null) {
        lifecycle = lifecycles.find((lc) => lc.status().position === readerPosition);
      } else {
        // Default: first connected reader.
        lifecycle = lifecycles.find((lc) => lc.status().connected);
        // Fall back to first reader regardless of connected state — the
        // sendMessage will fail with a meaningful error if not connected.
        if (!lifecycle) lifecycle = lifecycles[0];
      }

      if (!lifecycle) {
        return reply.code(503).send({
          error: 'no_reader',
          message: 'No SI reader configured. Start the bridge with --serial.',
        });
      }

      const station = lifecycle.getStation();
      if (!station) {
        return reply.code(503).send({
          error: 'no_reader',
          message: 'SI reader not connected. Check the bridge connection and retry.',
        });
      }

      // Read backup memory from the check unit.
      let readResult: { cardNumbers: number[]; overflow: boolean; readCount: number };
      try {
        const { records, overflow } = await readBackupMemory(station);
        const cardNumbers = [...new Set(records.map((r) => r.cardNumber))];
        readResult = { cardNumbers, overflow, readCount: cardNumbers.length };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ err, competitionId: id }, 'checkunit snapshot failed');
        return reply.code(500).send({ error: 'snapshot_failed', message });
      }

      // Find which cards have physically returned (card_read with finish punch).
      // We look at ALL card_read events for this competition and collect the
      // card_numbers whose most-recent card_read had a non-null finish field.
      //
      // Implementation: fetch all card_read events for this competition,
      // deduplicate by card_number keeping only the most recent, then filter
      // for non-null finish.
      interface CardReadRow {
        cardNumber: number;
        payload: EventPayload;
      }
      const cardReadRows = app.fartolaDb.db
        .select({
          cardNumber: events.payload,
          payload: events.payload,
        })
        .from(events)
        .where(and(eq(events.competitionId, id), eq(events.eventType, 'card_read')))
        .orderBy(desc(events.eventTimeMs))
        .all() as unknown as CardReadRow[];

      // Deduplicate: keep only the most-recent card_read per card number.
      // (orderBy desc means first occurrence per card is the latest.)
      const seenCards = new Set<number>();
      const returnedCardNumbers = new Set<number>();
      for (const row of cardReadRows) {
        const payload = row.payload;
        if (payload.event_type !== 'card_read') continue;
        const cn = payload.card_number;
        if (seenCards.has(cn)) continue;
        seenCards.add(cn);
        if (payload.finish !== null && payload.finish !== undefined) {
          returnedCardNumbers.add(cn);
        }
      }

      return reply.code(200).send({
        cardNumbers: readResult.cardNumbers,
        returnedCardNumbers: Array.from(returnedCardNumbers),
        overflow: readResult.overflow,
        readCount: readResult.readCount,
      });
    }
  );
}
