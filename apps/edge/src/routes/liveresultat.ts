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
//   GET | PATCH | DELETE /api/competitions/:id/liveresultat/credentials
//     The liveresultat competition id and upload password (SOFT TR 7.7.1:
//     liveresultat ska/bör erbjudas). PATCH { liveresultat_id,
//     liveresultat_pwd } sets both and enqueues a push; DELETE clears them.
//     Every answer is { liveresultat_id, has_password } — the password is
//     never returned, and the body field name is one log/redact.ts scrubs
//     (T-02.1-13). PATCH/DELETE are suffixed write routes, so the
//     event-code gate in server.ts applies.
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
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { DbHandle } from '../db/index.ts';
import { competitions } from '../db/schema.ts';
import type { PushQueueConfig, PushQueueHandle } from '../integrations/liveresultat/queue.ts';
import { issuesToErrors } from './_zod-errors.ts';

const CredentialsInput = z
  .object({
    /** liveresultat.orientering.se's numeric competition id. */
    liveresultat_id: z.string().trim().regex(/^\d+$/),
    liveresultat_pwd: z.string().min(1).max(200),
  })
  .strict();

/** The push queue's config for a competition: null until both the id and
 * the password are set. bin/fartola.ts reads it on every push attempt. */
export function liveresultatConfig(
  handle: DbHandle,
  competitionId: string
): PushQueueConfig | null {
  const row = handle.db
    .select({
      liveresultatId: competitions.liveresultatId,
      liveresultatPwd: competitions.liveresultatPwd,
      name: competitions.name,
      date: competitions.date,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (!row?.liveresultatId || !row.liveresultatPwd) return null;
  return {
    liveresultatId: row.liveresultatId,
    liveresultatPwd: row.liveresultatPwd,
    competitionName: row.name,
    competitionDate: row.date,
  };
}

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

  // Credentials: never the password itself, only whether one is set.
  const credentials = (
    id: string
  ): { liveresultat_id: string | null; has_password: boolean } | null => {
    const row = app.fartolaDb.db
      .select({ id: competitions.liveresultatId, pwd: competitions.liveresultatPwd })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!row) return null;
    return { liveresultat_id: row.id, has_password: row.pwd !== null && row.pwd.length > 0 };
  };
  const setCredentials = (id: string, liveresultatId: string | null, pwd: string | null): void => {
    app.fartolaDb.db
      .update(competitions)
      .set({ liveresultatId, liveresultatPwd: pwd })
      .where(eq(competitions.id, id))
      .run();
  };

  // GET /api/competitions/:id/liveresultat/credentials
  app.get<{ Params: { id: string } }>(
    '/api/competitions/:id/liveresultat/credentials',
    async (req, reply) => {
      const out = credentials(req.params.id);
      if (out === null) return reply.code(404).send({ error: 'competition not found' });
      return reply.code(200).send(out);
    }
  );

  // PATCH /api/competitions/:id/liveresultat/credentials — set id + password,
  // then push (the queue reads them from the row on every attempt).
  app.patch<{ Params: { id: string } }>(
    '/api/competitions/:id/liveresultat/credentials',
    async (req, reply) => {
      const { id } = req.params;
      const parsed = CredentialsInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      if (credentials(id) === null) return reply.code(404).send({ error: 'competition not found' });
      setCredentials(id, parsed.data.liveresultat_id, parsed.data.liveresultat_pwd);
      app.projectionStore.markDirty(id);
      app.liveresultatQueue?.enqueue(id);
      return reply.code(200).send(credentials(id));
    }
  );

  // DELETE /api/competitions/:id/liveresultat/credentials — stop pushing.
  app.delete<{ Params: { id: string } }>(
    '/api/competitions/:id/liveresultat/credentials',
    async (req, reply) => {
      const { id } = req.params;
      if (credentials(id) === null) return reply.code(404).send({ error: 'competition not found' });
      setCredentials(id, null, null);
      return reply.code(200).send(credentials(id));
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
