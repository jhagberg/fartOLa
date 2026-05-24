// Authored for fartola. Not ported from upstream.
//
// node:test coverage for classCache (Plan 02.1-09). Validates:
//
//   - Test 1: refreshClassCache with mock fetch returning MeOS class XML
//     → returns Map with correct classname→classid pairs.
//   - Test 2: refreshClassCache with mock fetch failing (network error)
//     → returns empty Map (graceful degradation).
//   - Test 3: refreshClassCache with empty class list → returns empty Map.
//   - Test 4: MIP entry builder includes classid="N" when class is in cache.
//   - Test 5: MIP entry builder includes classid="0" when class NOT in cache.
//   - Test 6: MIP entry builder still includes classname attribute.
//   - Test 7: Second call within TTL window reuses cached Map (no second fetch).
//   - Test 8: Call after TTL expiry triggers a refresh fetch.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-09-PLAN.md

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

import { refreshClassCache, resetClassCacheForTest, getClassCacheForTest } from './classCache.ts';
import { buildServer } from '../../server.ts';
import { openDatabase, type DbHandle } from '../../db/index.ts';
import { ensureNodeId } from '../../db/node-id.ts';

// ============================================================================
// refreshClassCache unit tests
// ============================================================================

describe('classCache — refreshClassCache', () => {
  const MEOS_HOST = '192.168.1.100';

  test('test 1: parses MeOS class XML and returns correct Map', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <cls id="1">Vit</cls>
  <cls id="2">Grön</cls>
  <cls id="3">Gul</cls>
</MOPComplete>`;
    const mockFetch = async () => ({ ok: true, text: async () => xml }) as Response;

    const result = await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(result.size, 3);
    assert.equal(result.get('Vit'), 1);
    assert.equal(result.get('Grön'), 2);
    assert.equal(result.get('Gul'), 3);
  });

  test('test 2: network error → returns empty Map (graceful degradation)', async () => {
    // Reset so there is no stale cache to serve; test 1 may have populated it.
    resetClassCacheForTest();
    const mockFetch = async (): Promise<Response> => {
      throw new Error('Network unreachable');
    };

    const result = await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(result.size, 0);
  });

  test('test 3: empty class list → returns empty Map', async () => {
    // Reset so there is no stale cache from earlier tests.
    resetClassCacheForTest();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
</MOPComplete>`;
    const mockFetch = async () => ({ ok: true, text: async () => xml }) as Response;

    const result = await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(result.size, 0);
  });

  test('test 7: second call within TTL reuses cached Map (no second fetch)', async () => {
    resetClassCacheForTest();
    let fetchCount = 0;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <cls id="10">TestClass</cls>
</MOPComplete>`;
    const mockFetch = async () => {
      fetchCount++;
      return { ok: true, text: async () => xml } as Response;
    };

    // First call — must fetch.
    const r1 = await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(fetchCount, 1);
    assert.equal(r1.get('TestClass'), 10);

    // Second call within TTL — must NOT fetch again.
    const r2 = await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(fetchCount, 1, 'should not re-fetch within TTL');
    assert.equal(r2.get('TestClass'), 10);
  });

  test('test 8: call after TTL expiry triggers a refresh fetch', async () => {
    resetClassCacheForTest();
    let fetchCount = 0;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <cls id="5">StaleFallback</cls>
</MOPComplete>`;
    const mockFetch = async () => {
      fetchCount++;
      return { ok: true, text: async () => xml } as Response;
    };

    // First call — fetches.
    await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(fetchCount, 1);

    // Artificially expire the TTL by backdating the cache timestamp.
    getClassCacheForTest().expireNow();

    // Second call after TTL — must re-fetch.
    await refreshClassCache(MEOS_HOST, mockFetch);
    assert.equal(fetchCount, 2, 'should re-fetch after TTL expiry');
  });
});

// ============================================================================
// MIP entry classid integration tests (Tests 4, 5, 6)
// ============================================================================

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
  return { app, handle };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
}

async function seedActiveCompetition(
  ctx: Ctx,
  opts: { className?: string } = {}
): Promise<{ competitionId: string; classId: string }> {
  const compRes = await ctx.app.inject({
    method: 'POST',
    url: '/api/competitions',
    payload: { name: '4-klubbs', date: '2026-05-20' },
  });
  assert.equal(compRes.statusCode, 201);
  const competitionId = (compRes.json() as { id: string }).id;
  const classRes = await ctx.app.inject({
    method: 'POST',
    url: `/api/competitions/${competitionId}/classes`,
    payload: { name: opts.className ?? 'Vit' },
  });
  assert.equal(classRes.statusCode, 201);
  const classId = (classRes.json() as { id: string }).id;

  const setRes = await ctx.app.inject({
    method: 'POST',
    url: '/api/sessions/active-competition',
    payload: { competition_id: competitionId },
  });
  assert.equal(setRes.statusCode, 200);

  return { competitionId, classId };
}

describe('MIP /mip classid in <entry>', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    resetClassCacheForTest();
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  test('test 4: MIP entry includes classid="N" when class is in cache', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx, { className: 'Vit' });
    // Pre-seed the classCache so /mip can look up classid=1 for "Vit".
    getClassCacheForTest().seed(new Map([['Vit', 1]]));

    await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Test, Runner',
        club: null,
        class_id: classId,
        card_number: 12345,
        consent: true,
      },
    });

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /classid="1"/);
  });

  test('test 5: MIP entry includes classid="0" when class NOT in cache', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx, { className: 'Grön' });
    // Cache is empty — Grön has no MeOS classid.
    getClassCacheForTest().seed(new Map());

    await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Test, Runner',
        club: null,
        class_id: classId,
        card_number: 99999,
        consent: true,
      },
    });

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /classid="0"/);
  });

  test('test 6: MIP entry still includes classname attribute (classid is additive)', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx, { className: 'Gul' });
    getClassCacheForTest().seed(new Map([['Gul', 3]]));

    await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Test, Runner',
        club: null,
        class_id: classId,
        card_number: 55555,
        consent: true,
      },
    });

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(res.statusCode, 200);
    // Both attributes present.
    assert.match(res.payload, /classname="Gul"/);
    assert.match(res.payload, /classid="3"/);
  });
});
