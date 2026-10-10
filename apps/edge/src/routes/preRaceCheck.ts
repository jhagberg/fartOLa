// Authored for fartola. Not ported from upstream.
//
// GET /api/competitions/:id/pre-race-check — "Kontroll inför tävlingen":
// the runners and classes that are still wrong before the first start
// (projection/preRaceCheck.ts says what each list means). 404 when the
// competition does not exist.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { competitions } from '../db/schema.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { preRaceCheck } from '../projection/preRaceCheck.ts';

export default async function registerPreRaceCheck(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/pre-race-check',
    async (req, reply) => {
      const { id } = req.params;
      const comp = app.fartolaDb.db
        .select({ level: competitions.level })
        .from(competitions)
        .where(eq(competitions.id, id))
        .get();
      const input = loadCompetitionInputs(app.fartolaDb, id);
      // Fresh projection: the operator fixes a row and checks again.
      const state = app.projectionStore.recomputeNow(id);
      if (!comp || input === null || state === null) {
        return reply.code(404).send({ error: 'competition not found' });
      }
      return preRaceCheck(input, state, comp.level);
    }
  );
}
