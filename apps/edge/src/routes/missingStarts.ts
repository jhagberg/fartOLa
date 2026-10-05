// Authored for fartola. Not ported from upstream.
//
// "Fastställ saknade starttider" (02.1-14 Task 15). At read-out a runner
// with no start gets a warning and no time (Task 13); when the race is over
// the secretariat sets them all at once with the day's final numbers.
//
//   - GET  /api/competitions/:id/missing-starts — every competitor flagged
//     missing_start, with check time, suggested start (check + the day's
//     check → start offset), finish, and the day's n / median / mean.
//   - POST /api/competitions/:id/missing-starts/apply
//     { items: [{ competitor_id, start_time_ms }] } — sets each start time
//     with the PATCH start-time route's validation, in one transaction:
//     any bad item → nothing is written.

import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { classes, competitions } from '../db/schema.ts';
import { cardClockToWallMs, wallMsToEpochMs } from '../projection/halfDayClockMath.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { StartTimeMs, setCompetitorStartTime } from './competitors.ts';

const ApplyInput = z
  .object({
    items: z
      .array(z.object({ competitor_id: z.string().min(1), start_time_ms: StartTimeMs }).strict())
      .min(1),
  })
  .strict();

class CompetitorNotFound extends Error {
  readonly competitorId: string;
  constructor(competitorId: string) {
    super('competitor_not_found');
    this.competitorId = competitorId;
  }
}

export default async function registerMissingStarts(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/missing-starts',
    async (req, reply) => {
      const { id } = req.params;
      const comp = app.fartolaDb.db
        .select({ id: competitions.id })
        .from(competitions)
        .where(eq(competitions.id, id))
        .get();
      if (!comp) return reply.code(404).send({ error: 'competition not found' });
      // Fresh projection: the listing follows a batch apply immediately.
      const state = app.projectionStore.recomputeNow(id);
      if (state === null) return reply.code(404).send({ error: 'competition not found' });

      const classNames = new Map(
        app.fartolaDb.db
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(eq(classes.competitionId, id))
          .orderBy(asc(classes.name))
          .all()
          .map((c) => [c.id, c.name])
      );
      const items = [...state.competitors.values()]
        .filter((v) => v.missing_start)
        .map((v) => {
          const read = v.card_read_history[v.card_read_history.length - 1]!;
          const { suggested_start_ms: suggested, suggested_start_offset_ms: offset } = v;
          return {
            competitor_id: v.id,
            name: v.name,
            club: v.club,
            class_id: v.class_id,
            class_name: classNames.get(v.class_id) ?? '',
            card_number: v.card_number,
            status: v.status,
            check_ms: suggested !== null && offset !== null ? suggested - offset : null,
            suggested_start_ms: suggested,
            // missing_start implies a finish on the latest read.
            finish_ms: wallMsToEpochMs(
              cardClockToWallMs(read.finish!, read.card_type, read.event_time_ms)
            ),
          };
        })
        .sort((a, b) => a.class_name.localeCompare(b.class_name) || a.name.localeCompare(b.name));
      return { ...state.check_to_start, items };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/missing-starts/apply',
    async (req, reply) => {
      const { id } = req.params;
      const parsed = ApplyInput.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
      const { items } = parsed.data;
      try {
        app.fartolaDb.sqlite.transaction(() => {
          for (const item of items) {
            const row = setCompetitorStartTime(
              app.fartolaDb.db,
              id,
              item.competitor_id,
              item.start_time_ms
            );
            if (!row) throw new CompetitorNotFound(item.competitor_id);
          }
        })();
      } catch (err) {
        if (err instanceof CompetitorNotFound) {
          return reply
            .code(404)
            .send({ error: 'competitor_not_found', competitor_id: err.competitorId });
        }
        throw err;
      }
      app.projectionStore.markDirty(id);
      return { updated: items.length };
    }
  );
}
