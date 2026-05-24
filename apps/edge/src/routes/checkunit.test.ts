// Authored for fartola. Not ported from upstream.
//
// Tests for POST /api/competitions/:id/checkunit/snapshot.
//
// Tests:
//   1) 404 when competition doesn't exist
//   2) 503 when no bridge reader is configured
//   3) 503 when bridge is configured but station is null (not connected)
//   4) 200 with cardNumbers from mock station; overflow=false; readCount matches
//   5) 200 returnedCardNumbers contains cards with finish punch in events table
//   6) reader query param selects correct lifecycle by position
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-06-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { competitions, events } from '../db/schema.ts';
import { proto, BLOCK_SIZE } from '@fartola/sportident';
import type { SiMainStation } from '@fartola/sportident';
import type { SiMessageWithoutMode } from '@fartola/sportident';
import type { HalfDayClock } from '@fartola/sportident';

// ---------------------------------------------------------------------------
// Minimal station interface for the mock (mirrors ISiStation)
// ---------------------------------------------------------------------------

interface MockStation {
  sendMessage(message: SiMessageWithoutMode, expectedResponses?: number): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 128-byte backup block with two card numbers. */
function makeTwoCardBlock(cn1: number, cn2: number): number[] {
  const block = new Array<number>(128).fill(0);
  const recLen = proto.REC_LEN; // 8
  // Record 0: cn1
  const off0 = 0;
  block[off0 + proto.BC_CN] = (cn1 >>> 24) & 0xff;
  block[off0 + proto.BC_CN + 1] = (cn1 >>> 16) & 0xff;
  block[off0 + proto.BC_CN + 2] = (cn1 >>> 8) & 0xff;
  block[off0 + proto.BC_CN + 3] = cn1 & 0xff;
  // Record 1: cn2
  const off1 = recLen;
  block[off1 + proto.BC_CN] = (cn2 >>> 24) & 0xff;
  block[off1 + proto.BC_CN + 1] = (cn2 >>> 16) & 0xff;
  block[off1 + proto.BC_CN + 2] = (cn2 >>> 8) & 0xff;
  block[off1 + proto.BC_CN + 3] = cn2 & 0xff;
  return block;
}

/** Build a GET_SYS_VAL response params array with the given memory pointer. */
function makeSysValParams(memPointer: number): number[] {
  const params = new Array<number>(128).fill(0);
  params[0x1c] = (memPointer >>> 24) & 0xff;
  params[0x1d] = (memPointer >>> 16) & 0xff;
  params[0x1e] = (memPointer >>> 8) & 0xff;
  params[0x1f] = memPointer & 0xff;
  return params;
}

/** Build a mock station that returns one block with two card numbers. */
function makeStationWithCards(cn1: number, cn2: number): MockStation {
  return {
    sendMessage(message: SiMessageWithoutMode) {
      if (message.command === proto.cmd.GET_SYS_VAL) {
        return Promise.resolve([makeSysValParams(BLOCK_SIZE)]);
      }
      if (message.command === proto.cmd.GET_BACKUP) {
        return Promise.resolve([makeTwoCardBlock(cn1, cn2)]);
      }
      return Promise.resolve([[]]);
    },
  };
}

/** Lifecycle shape expected by bridgeLifecycles. */
interface MockLifecycle {
  status(): {
    path: string;
    position: string | null;
    connected: boolean;
    lastPunchAt: number | null;
  };
  getStation(): SiMainStation | null;
}

function makeLifecycle(
  station: MockStation | null,
  position: string | null = null,
  connected = true
): MockLifecycle {
  return {
    status: () => ({ path: '/dev/ttyUSB0', position, connected, lastPunchAt: null }),
    getStation: () => station as unknown as SiMainStation | null,
  };
}

// HalfDayClock fixture value for tests.
const finishClock: HalfDayClock = { seconds_in_half_day: 40000, half_day: 0, weekday: null };
const startClock: HalfDayClock = { seconds_in_half_day: 36000, half_day: 0, weekday: null };

// ---------------------------------------------------------------------------
// Test context
// ---------------------------------------------------------------------------

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });

  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Test Cup',
      date: '2026-06-01',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
    })
    .run();

  return { app, handle, competitionId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkunit', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.db.$client.close();
  });

  test('Test 1: 404 when competition does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/nonexistent-id/checkunit/snapshot',
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'competition_not_found');
  });

  test('Test 2: 503 when no bridge readers are configured', async () => {
    // bridgeLifecycles defaults to [] — no reader configured.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/checkunit/snapshot`,
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'no_reader');
  });

  test('Test 3: 503 when station is null (not connected)', async () => {
    ctx.app.bridgeLifecycles = [makeLifecycle(null, null, false)];
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/checkunit/snapshot`,
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'no_reader');
  });

  test('Test 4: 200 returns cardNumbers from mock station', async () => {
    const station = makeStationWithCards(1428824, 7501853);
    ctx.app.bridgeLifecycles = [makeLifecycle(station)];

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/checkunit/snapshot`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      cardNumbers: number[];
      overflow: boolean;
      readCount: number;
    };
    assert.equal(body.overflow, false);
    assert.ok(Array.isArray(body.cardNumbers));
    assert.ok(body.cardNumbers.includes(1428824));
    assert.ok(body.cardNumbers.includes(7501853));
    assert.equal(body.readCount, body.cardNumbers.length);
  });

  test('Test 5: returnedCardNumbers includes cards with finish punch', async () => {
    const station = makeStationWithCards(1428824, 7501853);
    ctx.app.bridgeLifecycles = [makeLifecycle(station)];

    // Insert a card_read event for card 1428824 WITH a finish punch.
    const nodeId = ensureNodeId(ctx.handle);
    ctx.handle.db
      .insert(events)
      .values({
        nodeId,
        localSeq: 1,
        competitionId: ctx.competitionId,
        eventType: 'card_read',
        eventTimeMs: Date.now(),
        recordedAtMs: Date.now(),
        payload: {
          event_type: 'card_read',
          card_number: 1428824,
          card_type: 'SI9',
          start: startClock,
          finish: finishClock,
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();

    // card 7501853 has no finish punch (not returned).

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/checkunit/snapshot`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { returnedCardNumbers: number[] };
    assert.ok(body.returnedCardNumbers.includes(1428824), 'finished runner should be in returned');
    assert.ok(
      !body.returnedCardNumbers.includes(7501853),
      'non-finished runner should not be in returned'
    );
  });

  test('Test 6: reader query param selects lifecycle by position', async () => {
    const leftStation = makeStationWithCards(111111, 222222);
    const rightStation = makeStationWithCards(333333, 444444);
    ctx.app.bridgeLifecycles = [
      makeLifecycle(leftStation, 'left'),
      makeLifecycle(rightStation, 'right'),
    ];

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/checkunit/snapshot?reader=right`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { cardNumbers: number[] };
    assert.ok(body.cardNumbers.includes(333333), 'right reader cards should be present');
    assert.ok(body.cardNumbers.includes(444444), 'right reader cards should be present');
    assert.ok(!body.cardNumbers.includes(111111), 'left reader cards should not be present');
  });
});
