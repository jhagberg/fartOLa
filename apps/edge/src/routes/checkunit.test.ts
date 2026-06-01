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
import { proto, BLOCK_SIZE, cardNumber2arr } from '@fartola/sportident';
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

/** Encode a card number to its 3 wire bytes (big-endian), via cardNumber2arr. */
function cardBytes(cn: number): [number, number, number] {
  const [b0, b1, b2] = cardNumber2arr(cn);
  return [b2 as number, b1 as number, b0 as number];
}

/** GET_BACKUP response FRAME: [cmd, len, CN1, CN0, ADR2, ADR1, ADR0, ...data].
 * Each record: card bytes 0..2, 0x69 0x69 marker, 3-byte time. */
function makeTwoCardFrame(cn1: number, cn2: number): number[] {
  const data: number[] = [];
  for (const cn of [cn1, cn2]) {
    const [a, b, c] = cardBytes(cn);
    data.push(a, b, c, 0x69, 0x69, 0x00, 0x00, 0x00);
  }
  while (data.length < 128) data.push(0x00);
  const payload = [0x00, 0x02, 0x00, 0x01, 0x00, ...data];
  return [proto.cmd.GET_BACKUP, payload.length & 0xff, ...payload];
}

/** GET_SYS_VAL pointer response FRAME for an absolute pointer. */
function makePointerFrame(pointer: number): number[] {
  const ep3 = (pointer >>> 24) & 0xff;
  const ep2 = (pointer >>> 16) & 0xff;
  const ep1 = (pointer >>> 8) & 0xff;
  const ep0 = pointer & 0xff;
  const payload = [0x00, 0x02, 0x1c, ep3, ep2, 0x00, 0x00, 0x00, ep1, ep0];
  return [proto.cmd.GET_SYS_VAL, payload.length & 0xff, ...payload];
}

/** Build a mock station that returns one block with two card numbers.
 * Answers any SET_MS (coupled-mode relay) with a benign echo. */
function makeStationWithCards(cn1: number, cn2: number): MockStation {
  return {
    sendMessage(message: SiMessageWithoutMode) {
      if (message.command === proto.cmd.SET_MS) {
        return Promise.resolve([[proto.cmd.SET_MS, 0x01, 0x4d]]);
      }
      if (message.command === proto.cmd.GET_SYS_VAL) {
        // pointer one block beyond base → exactly one GET_BACKUP read.
        return Promise.resolve([makePointerFrame(0x100 + BLOCK_SIZE)]);
      }
      if (message.command === proto.cmd.GET_BACKUP) {
        return Promise.resolve([makeTwoCardFrame(cn1, cn2)]);
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
