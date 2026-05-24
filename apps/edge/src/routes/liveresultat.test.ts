// Authored for fartola. Not ported from upstream.
//
// Tests for liveresultat trigger routes:
//
//   POST /api/competitions/:id/liveresultat/push → 202 (no_queue → 503)
//   GET  /api/competitions/:id/liveresultat/status → queue status JSON
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 2

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import type { FastifyInstance } from 'fastify';
import type { PushQueueHandle, PushQueueStatus } from '../integrations/liveresultat/queue.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  enqueuedIds: string[];
  queueStatus: PushQueueStatus;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const enqueuedIds: string[] = [];
  const queueStatus: PushQueueStatus = {
    lastPushAt: null,
    lastSuccessAt: 1000,
    lastError: null,
    queueSize: 0,
    retryCount: 0,
  };

  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });

  // Attach a mock queue as a decoration
  const mockQueue: PushQueueHandle = {
    enqueue(id: string) {
      enqueuedIds.push(id);
    },
    stop() {
      /* noop */
    },
    status(): PushQueueStatus {
      return { ...queueStatus };
    },
  };
  app.decorate('liveresultatQueue', mockQueue);

  return { app, handle, enqueuedIds, queueStatus };
}

async function bootNoQueue(): Promise<{ app: FastifyInstance; handle: DbHandle }> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });
  // Do NOT decorate liveresultatQueue — test the no_queue path
  return { app, handle };
}

describe('liveresultat routes', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  it('POST /api/competitions/:id/liveresultat/push returns 202', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/comp-1/liveresultat/push',
    });
    assert.equal(res.statusCode, 202);
    const body = res.json() as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('POST enqueues the competition id without blocking', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/comp-abc/liveresultat/push',
    });
    assert.deepEqual(ctx.enqueuedIds, ['comp-abc']);
  });

  it('GET /api/competitions/:id/liveresultat/status returns queue status', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-1/liveresultat/status',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as PushQueueStatus;
    assert.equal(body.lastSuccessAt, 1000);
    assert.equal(body.lastPushAt, null);
    assert.equal(body.lastError, null);
    assert.equal(body.queueSize, 0);
    assert.equal(body.retryCount, 0);
  });

  it('POST returns 503 when no queue decorated', async () => {
    const { app, handle } = await bootNoQueue();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/competitions/x/liveresultat/push',
      });
      assert.equal(res.statusCode, 503);
      const body = res.json() as { ok: boolean; error: string };
      assert.equal(body.error, 'no_queue');
    } finally {
      await app.close();
      handle.close();
    }
  });

  it('GET returns 503 when no queue decorated', async () => {
    const { app, handle } = await bootNoQueue();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/competitions/x/liveresultat/status',
      });
      assert.equal(res.statusCode, 503);
    } finally {
      await app.close();
      handle.close();
    }
  });
});
