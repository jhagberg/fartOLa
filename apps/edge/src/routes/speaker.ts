// Authored for fartola. Not ported from upstream.
//
// GET /api/competitions/:id/speaker — the speaker board (speaker/board.ts):
// the projection's runners and results plus the stored ROC radio punches.
// Read-only. The speaker view refetches it on every results_update and
// radio_punch envelope on the results channel.

import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';

import { classes, competitions, events } from '../db/schema.ts';
import { competitionClockOffsetMin } from '../time/competitionClock.ts';
import { placeTimeOfDay } from '../integrations/roc/place.ts';
import { cardClockToEpochMs } from '../projection/halfDayClockMath.ts';
import { parseRocControls } from '../integrations/roc/status.ts';
import { buildSpeakerBoard, type BoardRunnerIn } from '../speaker/board.ts';
import { loadCourseDTOs } from './_courses.ts';

export default async function registerSpeakerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/competitions/:id/speaker', async (req, reply) => {
    const { id } = req.params;
    const db = app.fartolaDb.db;
    const comp = db
      .select({
        date: competitions.date,
        clockOffsetMin: competitions.clockOffsetMin,
        controlsText: competitions.rocControls,
        finishText: competitions.rocFinishCodes,
      })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!comp) return reply.code(404).send({ error: 'competition not found' });
    const state = app.projectionStore.get(id) ?? app.projectionStore.recomputeNow(id);
    if (state === null) return reply.code(404).send({ error: 'competition not found' });

    const classRows = db
      .select({
        id: classes.id,
        name: classes.name,
        course_id: classes.courseId,
        no_timing: classes.noTiming,
      })
      .from(classes)
      .where(eq(classes.competitionId, id))
      .orderBy(asc(classes.name))
      .all();

    const offsetMin = competitionClockOffsetMin(comp.date, comp.clockOffsetMin);
    const resultById = new Map(
      [...state.results_by_class.values()].flat().map((r) => [r.competitor_id, r])
    );
    const runners: BoardRunnerIn[] = [...state.competitors.values()].map((c) => {
      const res = resultById.get(c.id);
      // The clock time the speaker reads out is the finish punch itself, not
      // the readout and not start + running time (a time addition changes
      // the time, not when the runner crossed the line).
      const read = c.card_read_history.at(-1);
      const finishAt = read?.finish
        ? cardClockToEpochMs(read.finish, read.card_type, read.event_time_ms, offsetMin)
        : c.start_time_ms !== null && c.elapsed_time_ms !== null
          ? c.start_time_ms + c.elapsed_time_ms
          : (read?.event_time_ms ?? null);
      return {
        id: c.id,
        name: c.name,
        club: c.club,
        class_id: c.class_id,
        card_number: c.card_number,
        start_time_ms: c.start_time_ms,
        status: c.status,
        elapsed_time_ms: res?.elapsed_time_ms ?? null,
        place: res?.place ?? null,
        behind_leader_ms: res?.behind_leader_ms ?? null,
        finish_at_ms: finishAt,
      };
    });

    // Radio punches are placed from the time of day and the receive time, as
    // the poller and the radio status do.
    const radio = db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.competitionId, id), eq(events.eventType, 'radio_punch')))
      .all()
      .flatMap(({ payload: p }) =>
        p.event_type === 'radio_punch'
          ? [
              {
                card: p.card_number,
                code: p.control_code,
                timeMs: placeTimeOfDay(p.time_of_day, p.received_at_ms, offsetMin),
              },
            ]
          : []
      );

    return reply.code(200).send(
      buildSpeakerBoard({
        classes: classRows,
        courses: loadCourseDTOs(app.fartolaDb, id),
        runners,
        radio,
        radioControls: parseRocControls(comp.controlsText),
        finishCodes: parseRocControls(comp.finishText),
      })
    );
  });
}
