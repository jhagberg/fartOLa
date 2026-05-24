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
//   5. In a sqlite.transaction:
//      - UPDATE competitors SET start_time_ms = NULL for all in the class
//        (D-07: re-lotta wipes prior start_time_ms for the target class only).
//      - UPDATE each competitor's start_time_ms based on draw order.
//      - UPDATE classes SET first_start_ms + start_interval_sec.
//   6. Call app.projectionStore.markDirty(competitionId).
//   7. Return 201 { drawn: N }.
//
// Draw is NOT event-sourced (PATTERNS.md S-2 note): start_time_ms is a
// mutable column, not an event-sourced field. Re-lottning simply overwrites.
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
import { drawSOFT } from '../draw/soft.ts';
import { drawRandom } from '../draw/random.ts';
import { drawSimultaneous } from '../draw/simultaneous.ts';
import type { DrawRunner } from '../draw/types.ts';
import { issuesToErrors } from './_zod-errors.ts';

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const LottningInput = z
  .object({
    mode: z.enum(['SOFT', 'Random', 'Simultaneous']),
    firstStartMs: z.number().int().nonnegative(),
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

      // Load competitors for the class.
      const competitorRows = app.fartolaDb.db
        .select({ id: competitors.id, club: competitors.club })
        .from(competitors)
        .where(eq(competitors.classId, classId))
        .all();

      const runnerList: DrawRunner[] = competitorRows.map((r) => ({
        id: r.id,
        club: r.club,
      }));

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

      // Transactional write: wipe then assign (D-07).
      app.fartolaDb.sqlite.transaction(() => {
        // Wipe prior start_time_ms for all competitors in this class (re-lotta support).
        app.fartolaDb.db
          .update(competitors)
          .set({ startTimeMs: null })
          .where(eq(competitors.classId, classId))
          .run();

        // Assign new start times.
        for (const { id, startTimeMs } of assignments) {
          app.fartolaDb.db
            .update(competitors)
            .set({ startTimeMs })
            .where(eq(competitors.id, id))
            .run();
        }

        // Update class row with firstStartMs + intervalSec.
        app.fartolaDb.db
          .update(classes)
          .set({ firstStartMs, startIntervalSec: intervalSec })
          .where(eq(classes.id, classId))
          .run();
      })();

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
