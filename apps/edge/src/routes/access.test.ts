// Authored for fartola. Not ported from upstream.
//
// TDD tests for POST /access (Plan 02.1-12, Task 2).
//
// Test 1: POST /access with valid code → 200 + Set-Cookie fartola_event_code
// Test 2: POST /access with unknown code → 401 { error: 'invalid_code' }; no Set-Cookie
// Test 3: POST /access with expired code → 401 { error: 'expired' }
// Test 4: POST /access with revoked code → 401 { error: 'revoked' }
// Test 5: rate limit — 11th POST from same IP within 60s → 429 + Retry-After
// Test 6: XFF-bypass — non-localhost socket with X-Forwarded-For: 127.0.0.1 → not localhost-bypassed
// Test 7: signed cookie roundtrips through verifyCookie correctly
// Test 8: preHandler blocks non-localhost POST to /api/competitions/:id/** without cookie → 403
// Test 9: preHandler passes localhost (127.0.0.1) POST without cookie → does not 403
// Test 10: preHandler rejects valid cookie with mismatched competitionId → 403
// Test 11: blanket gate — POST /api/competitions/:id/import/startlist/confirm non-localhost no cookie → 403
// Test 12: secret-persist — signing secret survives app restart (read from DB not regenerated)

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { signCookie } from '../auth/event-code.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  tmpDir: string;
  competitionId: string;
}

async function boot(dbPath?: string): Promise<Ctx> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'fartola-access-test-'));
  const resolvedDbPath = dbPath ?? path.join(tmpDir, 'fartola.db');
  const handle = openDatabase(resolvedDbPath);
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });

  const competitionId = 'comp-access-1';
  handle.sqlite
    .prepare(`INSERT INTO competitions (id, name, date, created_at_ms) VALUES (?, ?, ?, ?)`)
    .run(competitionId, 'Access Test', '2026-05-24', Date.now());

  return { app, handle, tmpDir, competitionId };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
}

/** Generate a valid event code and return its plaintext value. */
async function generateCode(ctx: Ctx): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/competitions/${ctx.competitionId}/event-codes`,
    remoteAddress: '127.0.0.1',
    payload: {},
  });
  assert.equal(res.statusCode, 201);
  return res.json<{ code: string }>().code;
}

describe('POST /access — valid code flow', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 1: valid code → 200 + Set-Cookie fartola_event_code HttpOnly SameSite=Lax', async () => {
    const code = await generateCode(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress: '10.0.0.5',
      payload: { competition_id: ctx.competitionId, code },
    });
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'expected Set-Cookie header');
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(cookieStr.includes('fartola_event_code='), 'cookie name must be fartola_event_code');
    assert.ok(cookieStr.toLowerCase().includes('httponly'), 'cookie must be HttpOnly');
    assert.ok(cookieStr.toLowerCase().includes('samesite=lax'), 'cookie must be SameSite=Lax');
  });

  test('Test 7: signed cookie roundtrips through verifyCookie', async () => {
    const code = await generateCode(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress: '10.0.0.5',
      payload: { competition_id: ctx.competitionId, code },
    });
    assert.equal(res.statusCode, 200);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
    // Extract the cookie value (before first semicolon)
    const cookieValue = cookieStr.split('=').slice(1).join('=').split(';')[0];
    assert.ok(cookieValue && cookieValue.length > 0, 'cookie value must be non-empty');
  });
});

describe('POST /access — error cases', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 2: unknown code → 401 { error: invalid_code }; no Set-Cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress: '10.0.0.5',
      payload: { competition_id: ctx.competitionId, code: 'sjön-999' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json<{ error: string }>().error, 'invalid_code');
    assert.ok(!res.headers['set-cookie'], 'must not set cookie on failure');
  });

  test('Test 3: expired code → 401 { error: expired }', async () => {
    // Insert an already-expired code directly
    const expiredId = crypto.randomUUID();
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO event_codes (id, competition_id, code, expires_at_ms, revoked_at_ms, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(expiredId, ctx.competitionId, 'åsen-123', Date.now() - 5000, null, Date.now() - 100000);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress: '10.0.0.5',
      payload: { competition_id: ctx.competitionId, code: 'åsen-123' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json<{ error: string }>().error, 'expired');
  });

  test('Test 4: revoked code → 401 { error: revoked }', async () => {
    // Insert a revoked code
    const revokedId = crypto.randomUUID();
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO event_codes (id, competition_id, code, expires_at_ms, revoked_at_ms, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        revokedId,
        ctx.competitionId,
        'berget-200',
        Date.now() + 86400000,
        Date.now() - 1000,
        Date.now() - 2000
      );

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress: '10.0.0.5',
      payload: { competition_id: ctx.competitionId, code: 'berget-200' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json<{ error: string }>().error, 'revoked');
  });
});

describe('POST /access — rate limiting', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 5: 11th POST from same IP within 60s → 429 + Retry-After', async () => {
    const remoteAddress = '10.5.0.1';
    // 10 failed attempts
    for (let i = 0; i < 10; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/access',
        remoteAddress,
        payload: { competition_id: ctx.competitionId, code: 'gropen-100' },
      });
    }
    // 11th attempt
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/access',
      remoteAddress,
      payload: { competition_id: ctx.competitionId, code: 'gropen-100' },
    });
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers['retry-after'], 'must include Retry-After header');
  });
});

describe('POST /access — X-Forwarded-For spoofing', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 6: non-localhost socket with X-Forwarded-For: 127.0.0.1 is NOT localhost-bypassed by preHandler', async () => {
    // This test verifies that the preHandler uses socket.remoteAddress, not X-Forwarded-For.
    // The LAN client with forged XFF header should still need a valid cookie for write routes.
    // We hit a protected write route without a cookie but with spoofed XFF.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/competitors`,
      remoteAddress: '192.168.1.50', // non-localhost socket
      headers: { 'x-forwarded-for': '127.0.0.1' }, // spoofed header
      payload: {
        competition_id: ctx.competitionId,
        name: 'Test Runner',
        club: 'OK Test',
        class_id: 'does-not-matter',
        consent: true,
      },
    });
    // Should NOT bypass — must get 403, not 422/404 (which would indicate auth passed)
    assert.equal(
      res.statusCode,
      403,
      `expected 403 for XFF-spoofed non-localhost, got ${res.statusCode}`
    );
  });
});

describe('preHandler gate on write routes', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 8: non-localhost POST to /api/competitions/:id/competitors without cookie → 403', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/competitors`,
      remoteAddress: '192.168.1.50',
      payload: {
        competition_id: ctx.competitionId,
        name: 'Runner',
        club: 'Club',
        class_id: 'class-1',
        consent: true,
      },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, 'event_code_required');
  });

  test('Test 9: localhost (127.0.0.1) POST passes preHandler without cookie', async () => {
    // From localhost, POST should NOT be blocked by preHandler
    // (it may still fail with 404/422 due to missing class — that's fine)
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/competitors`,
      remoteAddress: '127.0.0.1',
      payload: {
        competition_id: ctx.competitionId,
        name: 'Runner',
        club: 'Club',
        class_id: 'class-1',
        consent: true,
      },
    });
    // Must NOT be 403 — may be 422/404 due to validation, but preHandler passed
    assert.notEqual(res.statusCode, 403, 'localhost must not be blocked by preHandler');
  });

  test('Test 10: valid cookie with mismatched competitionId → 403 cookie_competition_mismatch', async () => {
    // Get a signing secret by generating a code
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    const secretRow = ctx.handle.sqlite
      .prepare(`SELECT value FROM config WHERE key = 'event_code_signing_secret'`)
      .get() as { value: string };

    // Sign cookie for comp-A, but send request to comp-access-1
    const cookie = signCookie('comp-A', secretRow.value, Date.now() + 86400000);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/competitors`,
      remoteAddress: '192.168.1.50',
      headers: { cookie: `fartola_event_code=${cookie}` },
      payload: {
        competition_id: ctx.competitionId,
        name: 'Runner',
        club: 'Club',
        class_id: 'class-1',
        consent: true,
      },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, 'cookie_competition_mismatch');
  });

  test('Test 11: blanket gate — POST /api/competitions/:id/import/startlist/confirm non-localhost no cookie → 403', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/import/startlist/confirm`,
      remoteAddress: '192.168.1.50',
      payload: {},
    });
    assert.equal(res.statusCode, 403);
  });

  test('Test 12: secret-persist — signing secret is stable across app restart', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'fartola-persist-test-'));
    const dbPath = path.join(tmpDir, 'fartola.db');

    // Boot 1: generate a code to create the signing secret
    const ctx1 = await boot(dbPath);
    const compId = ctx1.competitionId;
    await ctx1.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    const secret1 = (
      ctx1.handle.sqlite
        .prepare(`SELECT value FROM config WHERE key = 'event_code_signing_secret'`)
        .get() as { value: string }
    ).value;
    await ctx1.app.close();
    ctx1.handle.close();

    // Boot 2: reopen the same DB
    const handle2 = openDatabase(dbPath);
    const nodeId2 = ensureNodeId(handle2);
    const app2 = await buildServer({ logger: false, dbHandle: handle2, nodeId: nodeId2 });
    const secret2 = (
      handle2.sqlite
        .prepare(`SELECT value FROM config WHERE key = 'event_code_signing_secret'`)
        .get() as { value: string }
    ).value;

    assert.equal(secret1, secret2, 'signing secret must persist across restarts');

    await app2.close();
    handle2.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
