// Authored for fartola. Not ported from upstream.
//
// GET /api/health — health probe returning the shared HealthDTO.
// Used by the dev-proxy smoke check in plan 01 and by Playwright e2e
// scaffolding in plan 03. node_id is sourced from $FARTOLA_NODE_ID (defaults
// to 'local-dev' so a fresh install works); uptime_ms reflects the bridge
// process lifetime, not the OS uptime.
//
// Plan 04 (D-01 / REQ-OPS-004): includes per-reader status in the `readers`
// array from app.bridgeLifecycles. Empty array when --no-bridge is set.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-01-PLAN.md task 2
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-04-PLAN.md task 2
// - shared HealthDTO type: packages/shared-types/src/dtos.ts

import type { FastifyInstance } from 'fastify';
import type { HealthDTO } from '@fartola/shared-types';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthDTO> => {
    const nodeId = process.env.FARTOLA_NODE_ID ?? 'local-dev';
    const uptimeMs = Math.round(process.uptime() * 1000);
    const lifecycles = app.bridgeLifecycles ?? [];
    const readers = lifecycles.map((lc) => {
      const s = lc.status();
      return {
        path: s.path,
        position: s.position,
        connected: s.connected,
        last_punch_at: s.lastPunchAt,
      };
    });
    return {
      status: 'ok',
      node_id: nodeId,
      uptime_ms: uptimeMs,
      readers,
    };
  });
}
