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
import { startMs } from '../projection/dnfMp.ts';
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
        start_method: classes.startMethod,
      })
      .from(classes)
      .where(eq(classes.competitionId, id))
      .orderBy(asc(classes.name))
      .all();

    const offsetMin = competitionClockOffsetMin(comp.date, comp.clockOffsetMin);
    const resultById = new Map(
      [...state.results_by_class.values()].flat().map((r) => [r.competitor_id, r])
    );
    const startMethodOf = new Map(classRows.map((c) => [c.id, c.start_method]));
    const runners: BoardRunnerIn[] = [...state.competitors.values()].map((c) => {
      const res = resultById.get(c.id);
      const read = c.card_read_history.at(-1);
      // Splits run from the start the result runs from: by the class's start
      // method, the start punch of the read or the drawn start (dnfMp).
      const start = startMs({
        start: read?.start ?? null,
        cardType: read?.card_type ?? 'SI10',
        readAtMs: read?.event_time_ms ?? 0,
        drawnStartMs: c.start_time_ms,
        clockOffsetMin: offsetMin,
        startMethod: startMethodOf.get(c.class_id) ?? 'auto',
      });
      // The clock time the speaker reads out is when the runner crossed the
      // line: the manual finish, else the finish punch, else start + running
      // time without the time addition (which changes the time, not when).
      const finishAt =
        c.manual_finish_ms ??
        (read?.finish
          ? cardClockToEpochMs(read.finish, read.card_type, read.event_time_ms, offsetMin)
          : start !== null && c.elapsed_time_ms !== null
            ? start + c.elapsed_time_ms - c.time_addition_min * 60_000
            : (read?.event_time_ms ?? null));
      return {
        id: c.id,
        name: c.name,
        club: c.club,
        class_id: c.class_id,
        card_number: c.card_number,
        start_time_ms: start,
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
