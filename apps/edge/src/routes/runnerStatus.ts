// Authored for fartola. Not ported from upstream.
//
// GET /api/competitions/:id/runner-status — each runner's projected state
// for the Anmälda list's status filters (todo
// 2026-10-05-runners-list-with-status): { runners: [{ competitor_id,
// status, manual_status, missing_start }] }. 404 when the competition does
// not exist.

import type { FastifyInstance } from 'fastify';

export default async function registerRunnerStatus(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/competitions/:id/runner-status', async (req, reply) => {
    // Fresh projection: the list reads this right after an add, an import
    // or a withdrawal, and must not miss the runner just written.
    const state = app.projectionStore.recomputeNow(req.params.id);
    if (state === null) return reply.code(404).send({ error: 'competition not found' });
    return {
      runners: [...state.competitors.values()].map((v) => ({
        competitor_id: v.id,
        status: v.status,
        manual_status: v.manual_status,
        missing_start: v.missing_start,
      })),
    };
  });
}
