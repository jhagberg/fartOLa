// Authored for fartola. Not ported from upstream.
//
// Liveresultat push trigger routes — two endpoints:
//
//   POST /api/competitions/:id/liveresultat/push
//     Fire-and-forget: enqueues a push via the debounced queue and returns
//     202 immediately (D-10 — push never blocks local results). The route
//     NEVER awaits the actual push.
//
//   GET /api/competitions/:id/liveresultat/status
//     Returns the queue status snapshot { lastPushAt, lastSuccessAt,
//     lastError, queueSize, retryCount }. Addresses review concern
//     (GPT+Gemini HIGH — silent failure / no operator visibility).
//
// The PushQueueHandle is mounted on the FastifyInstance by bin/fartola.ts
// as app.liveresultatQueue. When the decoration is absent (tests that
// build the server without a queue) the route returns 503 with no_queue.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 2
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-PATTERNS.md S-7
// - REQ-STD-004

import type { FastifyInstance } from 'fastify';
import type { PushQueueHandle } from '../integrations/liveresultat/queue.ts';

export default async function registerLiveresultatRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/competitions/:id/liveresultat/push
  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/liveresultat/push',
    async (req, reply) => {
      const queue = (app as FastifyInstance & { liveresultatQueue?: PushQueueHandle })
        .liveresultatQueue;
      if (!queue) {
        return reply.code(503).send({ ok: false, error: 'no_queue' });
      }
      // Fire and forget — enqueue NEVER awaits the actual HTTP push (D-10).
      queue.enqueue(req.params.id);
      return reply.code(202).send({ ok: true });
    }
  );

  // GET /api/competitions/:id/liveresultat/status
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/liveresultat/status',
    async (req, reply) => {
      const queue = (app as FastifyInstance & { liveresultatQueue?: PushQueueHandle })
        .liveresultatQueue;
      if (!queue) {
        return reply.code(503).send({ ok: false, error: 'no_queue' });
      }
      return reply.code(200).send(queue.status());
    }
  );
}

// ---------------------------------------------------------------------------
// Module augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    /** Phase 2.1 liveresultat push queue. Decorated by bin/fartola.ts.
     * Absent in tests that build the server without a queue. */
    liveresultatQueue?: PushQueueHandle;
  }
}
