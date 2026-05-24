// Authored for fartola. Not ported from upstream.
//
// Session-scoped operator endpoints that toggle the bridge's runtime state:
//
//   POST   /api/sessions/active-competition  { competition_id }  → 200
//   DELETE /api/sessions/active-competition                      → 200
//   GET    /api/sessions/active-competition                      → 200 { competition_id }
//   POST   /api/sessions/reconnect-bridge                        → 200 or 503
//
// Active competition is held in-memory on `app.activeCompetitionId` AND
// persisted to the `config` table under key='active_competition_id' so it
// survives restarts. The SI bridge reads `getActiveCompetitionId()` on every
// station event — when null, events still persist with competition_id=null
// (forensic value) but no WS broadcast fires (T-IDLE-CHANNEL-LEAK
// mitigation).
//
// reconnect-bridge is wired via the optional `app.reconnectBridge` hook
// (set by apps/edge/src/bin/fartola.ts when it owns a live SerialTransport).
// When the bridge is detached (e.g. tests, --no-bridge), the route returns
// 503 with a small body. The route never mutates the bridge directly.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-06-PLAN.md task 2
// - REQ-EVT-CMP-005 (operator-toggled active competition)
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Pitfall 4: serialport EBUSY" (reconnect chain owns the retry; the
//   route just triggers it)

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { config, competitions } from '../db/schema.ts';

const ACTIVE_COMP_KEY = 'active_competition_id';

export function loadActiveCompetitionId(app: FastifyInstance): string | null {
  const row = app.fartolaDb.db
    .select({ value: config.value })
    .from(config)
    .where(eq(config.key, ACTIVE_COMP_KEY))
    .get();
  return row?.value ?? null;
}

function setActiveCompetitionIdRow(app: FastifyInstance, id: string | null): void {
  // Upsert into the config singleton table. Drizzle's onConflictDoUpdate is
  // available, but for a singleton we can do a simple delete+insert when
  // setting and delete-only when clearing.
  if (id === null) {
    app.fartolaDb.db.delete(config).where(eq(config.key, ACTIVE_COMP_KEY)).run();
    return;
  }
  app.fartolaDb.db
    .insert(config)
    .values({ key: ACTIVE_COMP_KEY, value: id })
    .onConflictDoUpdate({ target: config.key, set: { value: id } })
    .run();
}

export default async function registerSessionsRoutes(app: FastifyInstance): Promise<void> {
  // Restore active competition from config on plugin register. The route
  // module is registered after fartolaDb is decorated (server.ts ordering),
  // so the lookup is safe here.
  app.activeCompetitionId = loadActiveCompetitionId(app);

  app.get('/api/sessions/active-competition', async () => {
    return { competition_id: app.activeCompetitionId };
  });

  app.post('/api/sessions/active-competition', async (req, reply) => {
    const body = req.body as { competition_id?: unknown } | null;
    if (!body || typeof body.competition_id !== 'string' || body.competition_id.length === 0) {
      return reply.code(400).send({
        errors: [{ path: 'competition_id', code: 'invalid', message: 'string required' }],
      });
    }
    const id = body.competition_id;
    // Verify the comp exists — guards against typos that would leave events
    // with a competition_id FK that fails on insert later.
    const exists = app.fartolaDb.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!exists) {
      return reply.code(404).send({
        errors: [{ path: 'competition_id', code: 'not_found', message: 'unknown competition' }],
      });
    }
    app.activeCompetitionId = id;
    setActiveCompetitionIdRow(app, id);
    return reply.code(200).send({ competition_id: id });
  });

  app.delete('/api/sessions/active-competition', async (_req, reply) => {
    app.activeCompetitionId = null;
    setActiveCompetitionIdRow(app, null);
    return reply.code(200).send({ competition_id: null });
  });

  app.get('/api/bridge/status', async () => {
    return { state: app.bridgeState };
  });

  app.post('/api/sessions/reconnect-bridge', async (_req, reply) => {
    const fn = app.reconnectBridge;
    if (!fn) {
      return reply
        .code(503)
        .send({ error: 'bridge_not_attached', message: 'no SI bridge owned by this process' });
    }
    try {
      await fn();
      return reply.code(200).send({ reconnected: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'reconnect_failed', message });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    /** In-memory cache of the operator-selected active competition. Null
     * means the bridge is idle (events persist with competition_id=null,
     * no WS broadcast). Mirrors the `config` table singleton. */
    activeCompetitionId: string | null;
    /** Optional hook owned by apps/edge/src/bin/fartola.ts. When set, the
     * POST /api/sessions/reconnect-bridge route invokes it to trigger a
     * SerialTransport teardown + retry chain. Absent in tests / --no-bridge.
     * Plan 04: reconnects ALL lifecycles in parallel. */
    reconnectBridge?: () => Promise<void>;
    /** Plan 04 (D-02 / REQ-OPS-004) — live array of per-reader lifecycle
     * objects, one per --serial entry. Empty array when --no-bridge is set.
     * Read by GET /api/health to report per-reader status. Set by
     * bin/fartola.ts before app.listen(). */
    bridgeLifecycles: Array<{
      status(): {
        path: string;
        position: string | null;
        connected: boolean;
        lastPunchAt: number | null;
      };
    }>;
  }
}
