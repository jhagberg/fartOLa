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
// Additive fields (SOFT TR 4.22.1, in-forest from every source; the fields
// above keep their meaning, cardNumbers now also holds the cards seen by
// radio or a start-punch read that are not out):
//   sources: Record<card, InForestSource[]>   — checkunit / radio Kxx / read
//   noCheckCardNumbers: number[]              — "ingen checkstämpling"
//   outCardNumbers: number[]                  — out by a hand-set status
//   returnedCardNumbers also holds manual finish times (TR 4.20.6)
//   checkunit: 'read' | 'stored' | 'unavailable'
//   updated: { checkunit_read_at_ms, radio_enabled, radio_last_punch_at_ms,
//              roc_last_success_at }
// With no reader connected the route answers 200 with the radio/read based
// list (checkunit: 'unavailable', or 'stored' when an earlier read exists)
// when at least one runner is not out; with nobody to list it keeps the
// 503 no_reader, so an empty answer is never an all-clear without the
// check unit having been read.
//
// GET /api/competitions/:id/in-forest returns the same list from stored data
// only (no reader), per runner with name/club/class.
//
// Error responses:
//   404  { error: 'competition_not_found' }
//   503  { error: 'no_reader', message: string }      — no bridge connected
//   503  { error: 'station_asleep', message: string } — coupled unit asleep;
//        operator must dip a card into the check unit to wake it, then retry
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
import { eq } from 'drizzle-orm';

import { competitions } from '../db/schema.ts';
import { loadInForest, type InForestData } from './_inForest.ts';
import type { CompetitorView } from '../projection/types.ts';
import {
  readBackupMemory,
  readCoupledBackupMemory,
  CoupledStationAsleepError,
} from '@fartola/sportident';

export default async function registerCheckunitRoutes(app: FastifyInstance): Promise<void> {
  const competitorsOf = (id: string): CompetitorView[] => {
    const state = app.projectionStore.get(id) ?? app.projectionStore.recomputeNow(id);
    return state ? [...state.competitors.values()] : [];
  };
  const updatedOf = (id: string, data: InForestData) => ({
    checkunit_read_at_ms: data.checkunit?.read_at_ms ?? null,
    radio_enabled: data.radio_enabled,
    radio_last_punch_at_ms: data.radio_last_punch_at_ms,
    roc_last_success_at: app.rocPoller?.status(id)?.lastSuccessAt ?? null,
  });

  // GET /api/competitions/:id/in-forest — the list from stored data only.
  app.get<{ Params: { id: string } }>('/api/competitions/:id/in-forest', async (req, reply) => {
    const { id } = req.params;
    const competitors = competitorsOf(id);
    const data = loadInForest(app.fartolaDb, id, competitors);
    if (!data) return reply.code(404).send({ error: 'competition_not_found' });
    const byCard = new Map(
      competitors.filter((c) => c.card_number !== null).map((c) => [c.card_number, c])
    );
    return reply.code(200).send({
      runners: data.cards.map((c) => {
        const r = byCard.get(c.card_number);
        return {
          ...c,
          competitor_id: r?.id ?? null,
          name: r?.name ?? null,
          club: r?.club ?? null,
          class_id: r?.class_id ?? null,
          start_time_ms: r?.start_time_ms ?? null,
        };
      }),
      overflow: data.checkunit?.overflow ?? false,
      updated: updatedOf(id, data),
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/checkunit/snapshot
  // ---------------------------------------------------------------------------
  // `mode` selects how the check unit is reached:
  //   - 'coupled' (DEFAULT): the BSFx check unit is inductively coupled on top
  //     of the BSMx master ("mini reader"). The master is switched to
  //     transparent mode (SET_MS 0x53) and commands are forwarded to the
  //     coupled station, then direct mode is restored. This is the normal
  //     field setup — a BSF8 has no USB port (pcprog5 §2.5).
  //   - 'direct': the station is itself plugged into USB and we read its own
  //     backup memory. Escape hatch for benches / debugging.
  app.post<{ Params: { id: string }; Querystring: { reader?: string; mode?: string } }>(
    '/api/competitions/:id/checkunit/snapshot',
    async (req, reply) => {
      const { id } = req.params;
      const readerPosition = req.query.reader ?? null;
      const mode = req.query.mode === 'direct' ? 'direct' : 'coupled';

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

      const station = lifecycle?.getStation() ?? null;
      if (!station) {
        // No reader: answer from radio, reads and the stored check-unit read
        // when that lists someone still in the forest (TR 4.22.1).
        const data = loadInForest(app.fartolaDb, id, competitorsOf(id));
        if (data && data.cards.length > 0) {
          return reply
            .code(200)
            .send(
              snapshotBody(
                id,
                data,
                data.checkunit?.cards ?? [],
                data.checkunit?.overflow ?? false,
                'stored'
              )
            );
        }
        return reply.code(503).send({
          error: 'no_reader',
          message: lifecycle
            ? 'SI reader not connected. Check the bridge connection and retry.'
            : 'No SI reader configured. Start the bridge with --serial.',
        });
      }

      // Read backup memory from the check unit. Coupled (default) wraps the
      // read in the SET_MS transparent-mode relay + §2.5 retry loop; direct
      // reads the USB-attached station's own memory.
      let readResult: { cardNumbers: number[]; overflow: boolean; readCount: number };
      try {
        const { records, overflow } =
          mode === 'direct'
            ? await readBackupMemory(station)
            : await readCoupledBackupMemory(station);
        const cardNumbers = [...new Set(records.map((r) => r.cardNumber))];
        readResult = { cardNumbers, overflow, readCount: cardNumbers.length };
        // Log SUCCESS so the operator gets confirmation in the edge window
        // (previously only failures were logged → a good read looked silent).
        app.log.info(
          { competitionId: id, mode, cardCount: cardNumbers.length, overflow },
          'checkunit snapshot ok'
        );
      } catch (err) {
        // Sleeping check unit → friendly 503 so the UI can prompt "dip a card to
        // wake it" instead of showing a 7.5s raw timeout. (pcprog §2.5: the
        // slaved station must be in active mode for the inductive link to sync.)
        if (err instanceof CoupledStationAsleepError) {
          app.log.warn({ competitionId: id }, 'checkunit asleep — operator must wake it');
          return reply.code(503).send({ error: 'station_asleep', message: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ err, competitionId: id, mode }, 'checkunit snapshot failed');
        return reply.code(500).send({ error: 'snapshot_failed', message });
      }

      // Keep the read: the in-forest list uses it with no reader connected.
      const readAtMs = Date.now();
      app.fartolaDb.db
        .update(competitions)
        .set({
          checkunitCards: JSON.stringify(readResult.cardNumbers),
          checkunitOverflow: readResult.overflow,
          checkunitReadAtMs: readAtMs,
        })
        .where(eq(competitions.id, id))
        .run();

      // Returned = a card read with a finish punch (the latest read per card)
      // or a manual finish time; computed statuses never count here.
      const data = loadInForest(app.fartolaDb, id, competitorsOf(id), {
        cards: readResult.cardNumbers,
        overflow: readResult.overflow,
        readAtMs,
      }) as InForestData;
      return reply
        .code(200)
        .send(snapshotBody(id, data, readResult.cardNumbers, readResult.overflow, 'read'));
    }
  );

  /** The snapshot response: the legacy fields plus the additive ones. */
  function snapshotBody(
    id: string,
    data: InForestData,
    checkunitCards: number[],
    overflow: boolean,
    mode: 'read' | 'stored'
  ) {
    const cardNumbers = [...new Set([...checkunitCards, ...data.cards.map((c) => c.card_number)])];
    return {
      cardNumbers,
      returnedCardNumbers: data.out.filter((o) => o.reason !== 'status').map((o) => o.card_number),
      overflow,
      readCount: cardNumbers.length,
      sources: Object.fromEntries(data.cards.map((c) => [c.card_number, c.sources])),
      noCheckCardNumbers: data.cards.filter((c) => c.no_check).map((c) => c.card_number),
      outCardNumbers: data.out.filter((o) => o.reason === 'status').map((o) => o.card_number),
      checkunit: data.checkunit === null ? 'unavailable' : mode,
      updated: updatedOf(id, data),
    };
  }
}
