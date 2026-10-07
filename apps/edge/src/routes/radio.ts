// Authored for fartola. Not ported from upstream.
//
// Radio controls (ROC input) — two endpoints:
//
//   GET /api/competitions/:id/radio/status
//     Settings, poll health and the watchdog per radio control (see
//     shared-types RadioStatus). Read-only.
//
//   PATCH /api/competitions/:id/radio/settings
//     { enabled?, roc_competition_id?, start_id? }. A suffixed write route,
//     so the event-code gate in server.ts applies. Changing the ROC id
//     forgets the stored start/last id (they belong to the old unit).
//
// The poller is decorated by bin/fartola.ts as app.rocPoller; without it
// (tests, --no-bridge boots) `poll` is null.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { competitions } from '../db/schema.ts';
import type { RocPollerHandle } from '../integrations/roc/poller.ts';
import { buildRadioStatus } from '../integrations/roc/status.ts';
import { issuesToErrors } from './_zod-errors.ts';

const SettingsInput = z
  .object({
    enabled: z.boolean().optional(),
    /** ROC unitId: digits only. null clears it. */
    roc_competition_id: z.string().trim().regex(/^\d+$/).nullable().optional(),
    /** First ROC row id of the competition; null = work it out on the next poll. */
    start_id: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

export default async function registerRadioRoutes(app: FastifyInstance): Promise<void> {
  const status = (id: string) =>
    buildRadioStatus(app.fartolaDb, id, Date.now(), app.rocPoller?.status(id) ?? null);

  app.get<{ Params: { id: string } }>('/api/competitions/:id/radio/status', async (req, reply) => {
    const out = status(req.params.id);
    if (out === null) return reply.code(404).send({ error: 'competition not found' });
    return reply.code(200).send(out);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/competitions/:id/radio/settings',
    async (req, reply) => {
      const { id } = req.params;
      const parsed = SettingsInput.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
      const cur = app.fartolaDb.db
        .select({
          enabled: competitions.rocEnabled,
          unitId: competitions.rocCompetitionId,
        })
        .from(competitions)
        .where(eq(competitions.id, id))
        .get();
      if (!cur) return reply.code(404).send({ error: 'competition not found' });

      const { enabled, roc_competition_id: unitId, start_id: startId } = parsed.data;
      const nextUnit = unitId === undefined ? cur.unitId : unitId;
      if ((enabled ?? cur.enabled) && !nextUnit) {
        return reply.code(400).send({ error: 'roc_competition_id_required' });
      }
      const set: Partial<typeof competitions.$inferInsert> = {};
      if (enabled !== undefined) set.rocEnabled = enabled;
      if (unitId !== undefined && unitId !== cur.unitId) {
        set.rocCompetitionId = unitId;
        set.rocStartId = null;
        set.rocLastId = null;
      }
      // An explicit start id wins, also over the reset above.
      if (startId !== undefined) {
        set.rocStartId = startId;
        set.rocLastId = null;
      }
      if (Object.keys(set).length > 0) {
        app.fartolaDb.db.update(competitions).set(set).where(eq(competitions.id, id)).run();
      }
      return reply.code(200).send(status(id));
    }
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    /** ROC poller. Decorated by bin/fartola.ts; absent in tests that build
     * the server without one. */
    rocPoller?: RocPollerHandle;
  }
}
