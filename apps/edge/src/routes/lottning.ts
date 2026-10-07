// Authored for fartola. Not ported from upstream.
//
// REST routes for start list draw (lottning).
//
// Routes registered here:
//   POST /api/competitions/:id/lottning/:classId — draw and write start times
//   GET  /api/competitions/:id/lottning/:classId — fetch current start list
//
// POST semantics (D-03/D-04/D-05/D-06/D-07):
//   1. Validate body with Zod (mode enum, numeric params).
//      Zod refinement rejects intervalSec <= 0 for SOFT and Random modes
//      (Gemini 3.1 Pro MEDIUM: prevents accidental mass start).
//   2. Cross-competition pre-flight: verify class belongs to competition → 404.
//   3. Load competitors for the class, build DrawRunner[] array.
//   4. Call the appropriate draw function based on mode.
//   5. writeStartTimes (db/startTimes.ts): one start_times_set event and the
//      start_time_ms cache, in one transaction (D-07: re-lotta replaces the
//      target class's start times only), plus classes.first_start_ms +
//      start_interval_sec.
//   6. Call app.projectionStore.markDirty(competitionId).
//   7. Return 201 { drawn: N }.
//
// Start times are events (ADR-0003 update 2026-10): a draw is one
// start_times_set event and can be undone (POST …/start-times/undo).
//
// T-02.1-04: mode is a Zod enum — only 'SOFT', 'Random', 'Simultaneous'.
// T-02.1-04b: intervalSec <= 0 rejected for SOFT and Random modes.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-02-PLAN.md task 2
// - D-03, D-04, D-05, D-06, D-07 (draw modes and start list semantics)

import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { classes, competitors } from '../db/schema.ts';
import { writeStartTimes } from '../db/startTimes.ts';
import { drawSOFT } from '../draw/soft.ts';
import { drawRandom } from '../draw/random.ts';
import { drawSimultaneous } from '../draw/simultaneous.ts';
import type { DrawRunner } from '../draw/types.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { StartTimeMs } from './competitors.ts';

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const LottningInput = z
  .object({
    mode: z.enum(['SOFT', 'Random', 'Simultaneous']),
    // Epoch ms, like every other start-time write (not ms since midnight).
    firstStartMs: StartTimeMs.unwrap(),
    intervalSec: z.number().int().min(0),
    vacantSlots: z.number().int().nonnegative().optional(),
  })
  .refine(
    (data) => {
      // T-02.1-04b: for individual-start modes, intervalSec must be > 0.
      if (data.mode === 'SOFT' || data.mode === 'Random') {
        return data.intervalSec > 0;
      }
      // Simultaneous: intervalSec is irrelevant so any value is accepted.
      return true;
    },
    {
      message: 'intervalSec must be > 0 for SOFT and Random draw modes',
      path: ['intervalSec'],
    }
  );

export default async function registerLottningRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/lottning/:classId — draw and write start times
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/lottning/:classId',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;

      const parsed = LottningInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const { mode, firstStartMs, intervalSec, vacantSlots = 0 } = parsed.data;

      // Cross-competition pre-flight: verify class belongs to this competition.
      const classRow = app.fartolaDb.db
        .select({ id: classes.id, competitionId: classes.competitionId })
        .from(classes)
        .where(and(eq(classes.id, classId), eq(classes.competitionId, competitionId)))
        .get();
      if (!classRow) {
        return reply.code(404).send({ error: 'class_not_found' });
      }

      // Load competitors for the class. SOFT TR 7.5.1: an entry without a
      // name is not drawn (it loses any start time it had).
      const competitorRows = app.fartolaDb.db
        .select({ id: competitors.id, name: competitors.name, club: competitors.club })
        .from(competitors)
        .where(eq(competitors.classId, classId))
        .all();

      const runnerList: DrawRunner[] = competitorRows
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ id: r.id, club: r.club }));

      // Run the draw algorithm.
      let drawResult;
      if (mode === 'SOFT') {
        drawResult = drawSOFT(runnerList, { vacantSlots });
      } else if (mode === 'Random') {
        drawResult = drawRandom(runnerList);
      } else {
        // Simultaneous
        drawResult = drawSimultaneous(runnerList);
      }

      // Assign start times based on draw order.
      // For Simultaneous: all runners get firstStartMs.
      // For SOFT/Random: runner at slot i (non-null) gets firstStartMs + slotIndex * intervalSec * 1000.
      const assignments: Array<{ id: string; startTimeMs: number }> = [];
      let slotIndex = 0;
      for (const slot of drawResult.order) {
        if (slot !== null) {
          const timeMs =
            mode === 'Simultaneous' ? firstStartMs : firstStartMs + slotIndex * intervalSec * 1000;
          assignments.push({ id: slot.id, startTimeMs: timeMs });
        }
        slotIndex++;
      }

      // One start_times_set event (ADR-0003 update 2026-10): every runner in
      // the class gets the drawn time or none (D-07: a redraw replaces all),
      // and the class gets its start grid. Undo: POST …/start-times/undo.
      const drawnAt = new Map(assignments.map((a) => [a.id, a.startTimeMs]));
      writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
        cause: 'draw',
        classId,
        changes: competitorRows.map((r) => ({
          competitorId: r.id,
          startTimeMs: drawnAt.get(r.id) ?? null,
        })),
        classGrid: { firstStartMs, intervalSec },
      });

      app.projectionStore.markDirty(competitionId);

      return reply.code(201).send({ drawn: assignments.length });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/competitions/:id/lottning/:classId — fetch current start list
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/lottning/:classId',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;

      // Cross-competition pre-flight.
      const classRow = app.fartolaDb.db
        .select({
          id: classes.id,
          name: classes.name,
          firstStartMs: classes.firstStartMs,
          startIntervalSec: classes.startIntervalSec,
          maxTimeSec: classes.maxTimeSec,
        })
        .from(classes)
        .where(and(eq(classes.id, classId), eq(classes.competitionId, competitionId)))
        .get();
      if (!classRow) {
        return reply.code(404).send({ error: 'class_not_found' });
      }

      // Fetch all competitors for this class that have a start_time_ms, sorted.
      const startList = app.fartolaDb.db
        .select({
          id: competitors.id,
          name: competitors.name,
          club: competitors.club,
          cardNumber: competitors.cardNumber,
          startTimeMs: competitors.startTimeMs,
        })
        .from(competitors)
        .where(and(eq(competitors.classId, classId), isNotNull(competitors.startTimeMs)))
        .orderBy(asc(competitors.startTimeMs))
        .all();

      return {
        class: {
          id: classRow.id,
          name: classRow.name,
          first_start_ms: classRow.firstStartMs,
          start_interval_sec: classRow.startIntervalSec,
          max_time_sec: classRow.maxTimeSec,
        },
        start_list: startList.map((r) => ({
          id: r.id,
          name: r.name,
          club: r.club,
          card_number: r.cardNumber,
          start_time_ms: r.startTimeMs,
        })),
      };
    }
  );
}
