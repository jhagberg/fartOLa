// Authored for fartola. Not ported from upstream.
//
// node:test coverage for /api/__dev/simulate-read. Exercises the full
// vertical the walking-skeleton e2e relies on: REST inserts a card_read
// event, the local_seq counter increments, the WS broadcaster fans out
// the envelope, and the printer sink receives a print call.
//
// T-DEV-ENDPOINT regression gate (test 2): with FARTOLA_DEV unset, the
// route is not registered and POST returns 404 via the global not-found
// handler.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { events } from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { PrinterSink, PrintEnvelope } from '../print/sink.ts';
import { eq } from 'drizzle-orm';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
  printed: PrintEnvelope[];
}

function recordingPrinterSink(printed: PrintEnvelope[]): PrinterSink {
  return {
    async isPrinterConnected() {
      return true;
    },
    async print(envelope) {
      printed.push(envelope);
    },
  };
}

async function bootWithDev(printed: PrintEnvelope[]): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    printerSink: recordingPrinterSink(printed),
  });
  return { app, handle, nodeId, printed };
}

describe('/api/__dev/simulate-read — FARTOLA_DEV gate', () => {
  // Snapshot the env var; each test sets/unsets explicitly.
  const SAVED = process.env['FARTOLA_DEV'];

  afterEach(() => {
    if (SAVED === undefined) delete process.env['FARTOLA_DEV'];
    else process.env['FARTOLA_DEV'] = SAVED;
  });

  test('test 2 (T-DEV-ENDPOINT): without FARTOLA_DEV, POST returns 404', async () => {
    delete process.env['FARTOLA_DEV'];
    const printed: PrintEnvelope[] = [];
    const ctx = await bootWithDev(printed);
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/__dev/simulate-read',
        payload: {
          competition_id: 'comp-x',
          card_number: 7501853,
          card_type: 'SI10',
          punches: [],
        },
      });
      assert.equal(res.statusCode, 404);
    } finally {
      await ctx.app.close();
      ctx.handle.close();
    }
  });
});

describe('/api/__dev/simulate-read — happy path', () => {
  const SAVED = process.env['FARTOLA_DEV'];
  let ctx: Ctx;
  let printed: PrintEnvelope[];

  beforeEach(async () => {
    process.env['FARTOLA_DEV'] = '1';
    printed = [];
    ctx = await bootWithDev(printed);
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
    if (SAVED === undefined) delete process.env['FARTOLA_DEV'];
    else process.env['FARTOLA_DEV'] = SAVED;
  });

  test('test 1: valid body returns 201 with local_seq + broadcasted; events row inserted', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: {
        competition_id: 'comp-1',
        card_number: 7501853,
        card_type: 'SI10',
        punches: [{ control_code: 31, time_ms: 1234500 }],
      },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { local_seq: number; broadcasted: boolean };
    assert.equal(body.local_seq, 1);
    assert.equal(body.broadcasted, true);

    const row = ctx.handle.db.select().from(events).where(eq(events.localSeq, 1)).get();
    assert.ok(row, 'events row must exist');
    assert.equal(row.eventType, 'card_read');
    assert.equal(row.competitionId, 'comp-1');
    assert.equal(row.nodeId, ctx.nodeId);

    // Printer sink received the print.
    assert.equal(printed.length, 1);
    assert.equal(printed[0]?.competition_id, 'comp-1');
    assert.equal(printed[0]?.card_number, 7501853);
    assert.equal(printed[0]?.template, 'classic');
  });

  test('a failing printer does not fail the simulated read: 201, event inserted', async () => {
    // run-local.sh defaults to the CUPS sink, whose receipt template needs
    // fields this dev print does not carry; the read must still land.
    const handle = openDatabase(':memory:');
    const app = await buildServer({
      logger: false,
      dbHandle: handle,
      nodeId: ensureNodeId(handle),
      printerSink: {
        async isPrinterConnected() {
          return true;
        },
        async print() {
          throw new TypeError("Cannot read properties of undefined (reading 'name')");
        },
      },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/__dev/simulate-read',
        payload: {
          competition_id: 'comp-1',
          card_number: 7501853,
          card_type: 'SI10',
          punches: [{ control_code: 31, time_ms: 1234500 }],
        },
      });
      assert.equal(res.statusCode, 201);
      const row = handle.db.select().from(events).where(eq(events.localSeq, 1)).get();
      assert.equal(row?.eventType, 'card_read');
    } finally {
      await app.close();
      handle.close();
    }
  });

  test('test 3: negative card_number returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: {
        competition_id: 'comp-1',
        card_number: -5,
        card_type: 'SI10',
        punches: [],
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 3b: missing competition_id returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: { card_number: 7501853, card_type: 'SI10', punches: [] },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 4: two POSTs return local_seq 1 then 2', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: {
        competition_id: 'comp-2',
        card_number: 100,
        card_type: 'SI10',
        punches: [],
      },
    });
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: {
        competition_id: 'comp-2',
        card_number: 200,
        card_type: 'SI10',
        punches: [],
      },
    });
    const a = first.json() as { local_seq: number };
    const b = second.json() as { local_seq: number };
    assert.equal(a.local_seq, 1);
    assert.equal(b.local_seq, 2);
  });
});

describe('/api/__dev/simulate-read — re-register without env (T-DEV-ENDPOINT)', () => {
  const SAVED = process.env['FARTOLA_DEV'];

  afterEach(() => {
    if (SAVED === undefined) delete process.env['FARTOLA_DEV'];
    else process.env['FARTOLA_DEV'] = SAVED;
  });

  test('test 5: route stops responding when env is unset on a fresh build', async () => {
    // First build with env=1 — route registered.
    process.env['FARTOLA_DEV'] = '1';
    const printed1: PrintEnvelope[] = [];
    const ctx1 = await bootWithDev(printed1);
    const res1 = await ctx1.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: { competition_id: 'c', card_number: 1, card_type: 'SI10', punches: [] },
    });
    assert.equal(res1.statusCode, 201);
    await ctx1.app.close();
    ctx1.handle.close();

    // Second build with env unset — route absent.
    delete process.env['FARTOLA_DEV'];
    const printed2: PrintEnvelope[] = [];
    const ctx2 = await bootWithDev(printed2);
    const res2 = await ctx2.app.inject({
      method: 'POST',
      url: '/api/__dev/simulate-read',
      payload: { competition_id: 'c', card_number: 1, card_type: 'SI10', punches: [] },
    });
    assert.equal(res2.statusCode, 404);
    await ctx2.app.close();
    ctx2.handle.close();
  });
});
