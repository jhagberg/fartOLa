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
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import type { FastifyInstance } from 'fastify';
import {
  createPushQueue,
  type PushQueueHandle,
  type PushQueueStatus,
} from '../integrations/liveresultat/queue.ts';
import { competitions, events } from '../db/schema.ts';
import { liveresultatConfig, liveresultatMopMeta } from './liveresultat.ts';
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

// SOFT TR 7.7.1: liveresultat ska (nivå 1) / bör (nivå 2) erbjudas — the
// operator sets the competition id and password, and the push queue runs.
describe('liveresultat credentials (SOFT TR 7.7.1)', () => {
  let ctx: Ctx;
  const PWD = 'hemligt-CANARY-7731';

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  async function createComp(app: FastifyInstance): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Live', date: '2026-10-04' },
    });
    return (res.json() as { id: string }).id;
  }

  it('SOFT TR 7.7.1: liveresultat id and password are set and cleared via the route; the password is never returned', async () => {
    const id = await createComp(ctx.app);
    const url = `/api/competitions/${id}/liveresultat/credentials`;

    const before = await ctx.app.inject({ method: 'GET', url });
    assert.deepEqual(before.json(), { liveresultat_id: null, has_password: false });

    const set = await ctx.app.inject({
      method: 'PATCH',
      url,
      payload: { liveresultat_id: '1234', liveresultat_pwd: PWD },
    });
    assert.equal(set.statusCode, 200);
    assert.deepEqual(set.json(), { liveresultat_id: '1234', has_password: true });
    assert.ok(!set.body.includes(PWD));
    // Setting them starts the push.
    assert.deepEqual(ctx.enqueuedIds, [id]);

    const got = await ctx.app.inject({ method: 'GET', url });
    assert.deepEqual(got.json(), { liveresultat_id: '1234', has_password: true });
    const comp = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${id}` });
    assert.ok(!comp.body.includes(PWD), 'the competition DTO must not carry the password');
    const row = ctx.handle.db
      .select({ pwd: competitions.liveresultatPwd })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    assert.equal(row?.pwd, PWD);

    const bad = await ctx.app.inject({
      method: 'PATCH',
      url,
      payload: { liveresultat_id: 'abc', liveresultat_pwd: PWD },
    });
    assert.equal(bad.statusCode, 400);
    assert.ok(!bad.body.includes(PWD));

    // Operator-guarded like the other write routes: a LAN client without an
    // event-code cookie is refused.
    for (const method of ['PATCH', 'DELETE'] as const) {
      const lan = await ctx.app.inject({
        method,
        url,
        remoteAddress: '192.168.1.50',
        payload: { liveresultat_id: '9', liveresultat_pwd: 'x' },
      });
      assert.equal(lan.statusCode, 403, method);
    }

    const cleared = await ctx.app.inject({ method: 'DELETE', url });
    assert.deepEqual(cleared.json(), { liveresultat_id: null, has_password: false });
    assert.equal(liveresultatConfig(ctx.handle, id), null);
  });

  it("SOFT TR 7.7.1: once the credentials are set the push queue posts the runners' results to liveresultat", async () => {
    const id = await createComp(ctx.app);
    const cls = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/classes`,
      payload: { name: 'H21' },
    });
    const classId = (cls.json() as { id: string }).id;
    for (const [name, card] of [
      ['Anna Andersson', 101],
      ['Bo Berg', 102],
    ] as const) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: {
          competition_id: id,
          name,
          club: 'OK Täby',
          class_id: classId,
          card_number: card,
          consent: true,
        },
      });
      assert.equal(res.statusCode, 201);
    }
    ctx.handle.sqlite
      .prepare('UPDATE competitions SET race_started_at_ms = 1 WHERE id = ?')
      .run(id);
    const clock = (sec: number) => ({
      half_day: 0 as const,
      seconds_in_half_day: sec,
      weekday: null,
    });
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'test-node',
        localSeq: 1,
        competitionId: id,
        eventType: 'card_read',
        eventTimeMs: Date.now(),
        recordedAtMs: Date.now(),
        payload: {
          event_type: 'card_read',
          card_number: 101,
          card_type: 'SI10',
          start: clock(36_000),
          finish: clock(36_000 + 1800),
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${id}/liveresultat/credentials`,
      payload: { liveresultat_id: '1234', liveresultat_pwd: PWD },
    });
    const posted: Array<{ competition: unknown; pwd: unknown; mop: string }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      posted.push({
        competition: form.get('competition'),
        pwd: form.get('pwd'),
        mop: await (form.get('mop') as Blob).text(),
      });
      return new Response('<MOPStatus status="OK"/>', { status: 200 });
    }) as unknown as typeof fetch;
    const silent = { info() {}, warn() {} } as unknown as FastifyInstance['log'];
    // As bin/fartola.ts wires it, with the same class/club lookup.
    const queue = createPushQueue({
      log: silent,
      getProjection: (cid) => ctx.app.projectionStore.recomputeNow(cid),
      getConfig: (cid) => liveresultatConfig(ctx.handle, cid),
      getMopMeta: (cid) => liveresultatMopMeta(ctx.handle, cid),
      debounceMs: 0,
      fetchImpl,
    });
    queue.enqueue(id);
    await new Promise((r) => setTimeout(r, 50));
    queue.stop();
    assert.equal(queue.status().lastError, null);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.competition, '1234');
    assert.equal(posted[0]!.pwd, PWD);
    const mop = posted[0]!.mop;
    assert.match(mop, new RegExp(`<cls id="${classId}">H21</cls>`));
    assert.match(mop, /<org id="OK Täby">OK Täby<\/org>/);
    // Anna read out OK in 30:00 (rt in tenths); Bo still out (stat 0, no rt).
    assert.match(
      mop,
      new RegExp(`<base cls="${classId}" stat="1" org="OK Täby" rt="18000">Anna Andersson</base>`)
    );
    assert.match(mop, new RegExp(`<base cls="${classId}" stat="0" org="OK Täby">Bo Berg</base>`));
  });

  it('SOFT TR 7.7.1: the liveresultat password never reaches the log', async () => {
    const handle = openDatabase(':memory:');
    const chunks: string[] = [];
    const app = await buildServer({
      logger: {
        level: 'trace',
        stream: new Writable({
          write(chunk: Buffer, _enc, cb): void {
            chunks.push(chunk.toString('utf8'));
            cb();
          },
        }),
      },
      dbHandle: handle,
      nodeId: ensureNodeId(handle),
    });
    try {
      const id = await createComp(app);
      const body = { liveresultat_id: '1234', liveresultat_pwd: PWD };
      // A careless debug line logging the body is scrubbed too.
      app.log.info({ req: { body } }, 'debug');
      app.log.info({ body }, 'debug');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/competitions/${id}/liveresultat/credentials`,
        payload: body,
      });
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 50));
      const joined = chunks.join('');
      assert.ok(joined.length > 0);
      assert.ok(!joined.includes(PWD), `password in the log:\n${joined}`);
    } finally {
      await app.close();
      handle.close();
    }
  });
});
