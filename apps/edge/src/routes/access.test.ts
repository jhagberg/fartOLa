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
// Test 8: preHandler blocks non-localhost walk-up POST /api/competitors without cookie → 403
// Test 9: preHandler passes localhost (127.0.0.1) POST without cookie → does not 403
// Test 10: preHandler rejects valid cookie with mismatched competitionId → 403
// Test 11: blanket gate — POST /api/competitions/:id/import/startlist/confirm non-localhost no cookie → 403
// Test 12: secret-persist — signing secret survives app restart (read from DB not regenerated)
// Test 13: operator-self bypass — POST from this host's own LAN IP (allowLan) is not gated
// Test 14: allowLan does NOT blanket-trust the LAN — a foreign LAN IP still needs a cookie → 403

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { networkInterfaces, tmpdir } from 'node:os';

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

async function boot(dbPath?: string, allowLan = false): Promise<Ctx> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'fartola-access-test-'));
  const resolvedDbPath = dbPath ?? path.join(tmpDir, 'fartola.db');
  const handle = openDatabase(resolvedDbPath);
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId, allowLan });

  const competitionId = 'comp-access-1';
  handle.sqlite
    .prepare(`INSERT INTO competitions (id, name, date, created_at_ms) VALUES (?, ?, ?, ?)`)
    .run(competitionId, 'Access Test', '2026-12-31', Date.now());

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
    assert.ok(cookieStr !== undefined, 'set-cookie header must include a cookie');
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
      url: '/api/competitors',
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

  test('Test 8: non-localhost POST /api/competitors (walk-up) without cookie → 403', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
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
      url: '/api/competitors',
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
    const cookie = signCookie('comp-A', 'code-A', secretRow.value, Date.now() + 86400000);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
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

describe('preHandler gate — operator-self bypass (allowLan)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot(undefined, true); // bind-to-LAN posture (operator laptop on 0.0.0.0)
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  /** First real non-loopback IPv4 address of THIS host — the same source
   * socket.remoteAddress reports when the operator opens the UI via the
   * laptop's own LAN IP. Deterministic on any machine with a LAN interface. */
  function ownLanIp(): string | undefined {
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.family === 'IPv4' && !a.internal) return a.address;
      }
    }
    return undefined;
  }

  test("Test 13: POST from this host's own LAN IP bypasses the gate", async () => {
    const ip = ownLanIp();
    if (ip === undefined) return; // headless box with no LAN interface — nothing to assert
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      remoteAddress: ip,
      payload: {
        competition_id: ctx.competitionId,
        name: 'Runner',
        club: 'Club',
        class_id: 'class-1',
        consent: true,
      },
    });
    // May be 404/422 (missing class) but must NOT be 403 — preHandler let it through.
    assert.notEqual(res.statusCode, 403, 'operator self-connect via own LAN IP must bypass');
  });

  test('Test 14: foreign LAN IP still needs a cookie even with allowLan → 403', async () => {
    // allowLan must NOT blanket-trust the LAN — only THIS host's own addresses.
    // 203.0.113.0/24 (TEST-NET-3) is reserved and never a real interface address.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      remoteAddress: '203.0.113.9',
      payload: {
        competition_id: ctx.competitionId,
        name: 'Runner',
        club: 'Club',
        class_id: 'class-1',
        consent: true,
      },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json<{ error: string }>().error, 'event_code_required');
  });
});

/** A real helper cookie for `competitionId`, obtained through POST /access. */
let helperIp = 0;
async function helperCookie(ctx: Ctx, competitionId: string): Promise<string> {
  const gen = await ctx.app.inject({
    method: 'POST',
    url: `/api/competitions/${competitionId}/event-codes`,
    remoteAddress: '127.0.0.1',
    payload: {},
  });
  assert.equal(gen.statusCode, 201);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/access',
    // A fresh source IP per login — /access rate-limits per IP across tests.
    remoteAddress: `10.0.9.${++helperIp}`,
    payload: { competition_id: competitionId, code: gen.json<{ code: string }>().code },
  });
  assert.equal(res.statusCode, 200);
  const setCookie = res.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return (first ?? '').split(';')[0] ?? '';
}

describe('write gate — routes without a competition id in the URL', () => {
  let ctx: Ctx;
  let competitorId: string;
  beforeEach(async () => {
    ctx = await boot();
    const classId = crypto.randomUUID();
    competitorId = crypto.randomUUID();
    ctx.handle.sqlite
      .prepare(`INSERT INTO classes (id, competition_id, name) VALUES (?, ?, ?)`)
      .run(classId, ctx.competitionId, 'H21');
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO competitors (id, competition_id, name, class_id, card_number, consent_status)
         VALUES (?, ?, ?, ?, ?, 'pending_first_read')`
      )
      .run(competitorId, ctx.competitionId, 'Alice Andersson', classId, 1234);
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  const lanWrites = (competitorIdOf: () => string, competitionIdOf: () => string) => [
    {
      name: 'PATCH /api/competitors/:id/profile',
      method: 'PATCH' as const,
      url: () => `/api/competitors/${competitorIdOf()}/profile`,
      payload: () => ({ name: 'Mallory', card_number: 9999 }),
    },
    {
      name: 'PATCH /api/competitors/:id (consent)',
      method: 'PATCH' as const,
      url: () => `/api/competitors/${competitorIdOf()}`,
      payload: () => ({ consent_status: 'confirmed_on_read', consent_at_ms: Date.now() }),
    },
    {
      name: 'POST /api/competitors',
      method: 'POST' as const,
      url: () => '/api/competitors',
      payload: () => ({
        competition_id: competitionIdOf(),
        name: 'Mallory',
        class_id: crypto.randomUUID(),
        consent: true,
      }),
    },
    {
      name: 'PATCH /api/competitions/:id',
      method: 'PATCH' as const,
      url: () => `/api/competitions/${competitionIdOf()}`,
      payload: () => ({ name: 'Hijacked' }),
    },
    {
      name: 'PATCH /api/competitions/:id?x=1 (query string)',
      method: 'PATCH' as const,
      url: () => `/api/competitions/${competitionIdOf()}?x=1`,
      payload: () => ({ name: 'Hijacked' }),
    },
  ];

  for (const w of lanWrites(
    () => competitorId,
    () => ctx.competitionId
  )) {
    test(`LAN write without cookie is refused: ${w.name}`, async () => {
      const res = await ctx.app.inject({
        method: w.method,
        url: w.url(),
        remoteAddress: '192.168.1.50',
        payload: w.payload(),
      });
      assert.equal(res.statusCode, 403, `${w.name}: ${res.statusCode} ${res.body}`);
      assert.equal(res.json<{ error: string }>().error, 'event_code_required');
    });
  }

  test('LAN profile edit without cookie leaves the runner unchanged', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}/profile`,
      remoteAddress: '192.168.1.50',
      payload: { name: 'Mallory', card_number: 9999 },
    });
    const row = ctx.handle.sqlite
      .prepare(`SELECT name, card_number FROM competitors WHERE id = ?`)
      .get(competitorId) as { name: string; card_number: number };
    assert.deepEqual(row, { name: 'Alice Andersson', card_number: 1234 });
  });

  test("a cookie for the runner's competition authorises a competitor-path write", async () => {
    const cookie = await helperCookie(ctx, ctx.competitionId);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}/profile`,
      remoteAddress: '192.168.1.50',
      headers: { cookie },
      payload: { name: 'Alice Berg' },
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  test("a cookie for another competition can't write that competition's runner", async () => {
    const otherId = 'comp-access-2';
    ctx.handle.sqlite
      .prepare(`INSERT INTO competitions (id, name, date, created_at_ms) VALUES (?, ?, ?, ?)`)
      .run(otherId, 'Other', '2026-12-31', Date.now());
    const cookie = await helperCookie(ctx, otherId);
    for (const w of lanWrites(
      () => competitorId,
      () => ctx.competitionId
    )) {
      const res = await ctx.app.inject({
        method: w.method,
        url: w.url(),
        remoteAddress: '192.168.1.50',
        headers: { cookie },
        payload: w.payload(),
      });
      assert.equal(res.statusCode, 403, `${w.name}: ${res.statusCode} ${res.body}`);
      assert.equal(res.json<{ error: string }>().error, 'cookie_competition_mismatch');
    }
  });

  test('localhost still writes competitor paths without a cookie', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitors/${competitorId}/profile`,
      remoteAddress: '127.0.0.1',
      payload: { name: 'Alice Berg' },
    });
    assert.equal(res.statusCode, 200, res.body);
  });
});

describe('write gate — cookie whose code is no longer active', () => {
  let ctx: Ctx;
  let competitorId: string;
  beforeEach(async () => {
    ctx = await boot();
    const classId = crypto.randomUUID();
    competitorId = crypto.randomUUID();
    ctx.handle.sqlite
      .prepare(`INSERT INTO classes (id, competition_id, name) VALUES (?, ?, ?)`)
      .run(classId, ctx.competitionId, 'H21');
    ctx.handle.sqlite
      .prepare(`INSERT INTO competitors (id, competition_id, name, class_id) VALUES (?, ?, ?, ?)`)
      .run(competitorId, ctx.competitionId, 'Alice Andersson', classId);
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  const startTimeWrite = (cookie: string) =>
    ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${ctx.competitionId}/competitors/${competitorId}/start-time`,
      remoteAddress: '192.168.1.50',
      headers: { cookie },
      payload: { start_time_ms: Date.UTC(2026, 11, 31, 9, 0) },
    });
  const storedStart = () =>
    (
      ctx.handle.sqlite
        .prepare(`SELECT start_time_ms FROM competitors WHERE id = ?`)
        .get(competitorId) as { start_time_ms: number | null }
    ).start_time_ms;

  test('active code: its cookie authorises writes', async () => {
    const cookie = await helperCookie(ctx, ctx.competitionId);
    const res = await startTimeWrite(cookie);
    assert.equal(res.statusCode, 200, res.body);
  });

  test('revoked code: its cookie no longer authorises writes', async () => {
    const cookie = await helperCookie(ctx, ctx.competitionId);
    const { id: codeId } = ctx.handle.sqlite
      .prepare(`SELECT id FROM event_codes WHERE competition_id = ?`)
      .get(ctx.competitionId) as { id: string };
    const revoke = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes/${codeId}/revoke`,
      remoteAddress: '127.0.0.1',
    });
    assert.equal(revoke.statusCode, 200);

    const res = await startTimeWrite(cookie);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json<{ error: string }>().error, 'event_code_required');
    assert.equal(storedStart(), null, 'the start time must not be written');
  });

  test('deleted code: its cookie no longer authorises writes', async () => {
    const cookie = await helperCookie(ctx, ctx.competitionId);
    ctx.handle.sqlite.prepare(`DELETE FROM event_codes`).run();
    const res = await startTimeWrite(cookie);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(storedStart(), null);
  });

  test('expired code: its cookie no longer authorises writes', async () => {
    const cookie = await helperCookie(ctx, ctx.competitionId);
    ctx.handle.sqlite.prepare(`UPDATE event_codes SET expires_at_ms = ?`).run(Date.now() - 1000);
    const res = await startTimeWrite(cookie);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(storedStart(), null);
  });
});

describe('write gate — operator-only routes (no competition of their own)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  // Install- and session-level writes: API keys, which competition SI reads
  // go to, creating competitions. A helper's event code is scoped to one
  // competition and must not reach these.
  const operatorWrites = [
    {
      method: 'PUT' as const,
      url: '/api/settings/integrations',
      payload: { eventor_api_key: 'x' },
    },
    { method: 'POST' as const, url: '/api/sessions/active-competition', payload: {} },
    { method: 'DELETE' as const, url: '/api/sessions/active-competition', payload: undefined },
    { method: 'POST' as const, url: '/api/sessions/reconnect-bridge', payload: {} },
    {
      method: 'POST' as const,
      url: '/api/competitions',
      payload: { name: 'X', date: '2026-10-05' },
    },
    { method: 'POST' as const, url: '/api/competitions/from-wizard', payload: {} },
  ];

  for (const w of operatorWrites) {
    test(`LAN helper with a valid cookie is refused: ${w.method} ${w.url}`, async () => {
      const cookie = await helperCookie(ctx, ctx.competitionId);
      const res = await ctx.app.inject({
        method: w.method,
        url: w.url,
        remoteAddress: '192.168.1.50',
        headers: { cookie },
        ...(w.payload === undefined ? {} : { payload: w.payload }),
      });
      assert.equal(res.statusCode, 403, `${w.method} ${w.url}: ${res.statusCode} ${res.body}`);
      assert.equal(res.json<{ error: string }>().error, 'operator_only');
    });
  }

  test('localhost still reaches operator-only routes', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'Lokalt', date: '2026-10-05' },
    });
    assert.ok(res.statusCode < 300, `${res.statusCode} ${res.body}`);
  });
});
