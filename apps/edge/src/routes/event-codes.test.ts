// Authored for fartola. Not ported from upstream.
//
// TDD tests for admin event-code routes (Plan 02.1-12, Task 2).
//
//   POST /api/competitions/:id/event-codes — generate code (localhost only)
//   GET  /api/competitions/:id/event-codes — list masked codes (localhost only)
//   POST /api/competitions/:id/event-codes/:codeId/revoke — revoke (localhost only)
//
// Test 1: POST generates code, returns 201 { id, code, expires_at_ms }
// Test 2: POST auto-generates and persists event_code_signing_secret on first call
// Test 3: GET returns masked codes (masked_code = first3****last2), not plaintext
// Test 4: POST :codeId/revoke sets revoked_at_ms; subsequent validateCode returns null
// Test 5: POST response code field is NOT present in logs (redaction)
// Test 6: POST returns 404 when competition_id doesn't exist
// Test 7: POST and revoke reject non-localhost with 403

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { validateCode } from '../auth/event-code.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  tmpDir: string;
  competitionId: string;
}

async function boot(): Promise<Ctx> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'fartola-event-codes-test-'));
  const dbPath = path.join(tmpDir, 'fartola.db');
  const handle = openDatabase(dbPath);
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });

  // Insert a competition to use across tests.
  const competitionId = 'comp-test-1';
  handle.sqlite
    .prepare(`INSERT INTO competitions (id, name, date, created_at_ms) VALUES (?, ?, ?, ?)`)
    .run(competitionId, 'Testvasan', '2026-05-24', Date.now());

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

describe('POST /api/competitions/:id/event-codes', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 1: generates code, returns 201 { id, code, expires_at_ms }', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${res.body}`);
    const body = res.json<{ id: string; code: string; expires_at_ms: number }>();
    assert.ok(typeof body.id === 'string' && body.id.length > 0, 'missing id');
    assert.ok(typeof body.code === 'string', 'missing code');
    assert.match(
      body.code,
      /^[a-zåäö]+-[1-9][0-9]{2}$/,
      `code '${body.code}' does not match expected pattern`
    );
    assert.ok(typeof body.expires_at_ms === 'number', 'missing expires_at_ms');
    assert.ok(body.expires_at_ms > Date.now(), 'expires_at_ms must be in the future');
  });

  test('Test 2: auto-generates and persists signing secret on first call, reuses on subsequent', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    // Read the secret from config table
    const row1 = ctx.handle.sqlite
      .prepare(`SELECT value FROM config WHERE key = 'event_code_signing_secret'`)
      .get() as { value: string } | undefined;
    assert.ok(row1 && row1.value.length > 0, 'signing secret must be persisted on first call');

    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    // Second call must reuse the same secret
    const row2 = ctx.handle.sqlite
      .prepare(`SELECT value FROM config WHERE key = 'event_code_signing_secret'`)
      .get() as { value: string } | undefined;
    assert.equal(row1.value, row2?.value, 'signing secret must be stable across calls');
  });

  test('Test 6: returns 404 when competition_id does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/nonexistent-comp/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    assert.equal(res.statusCode, 404);
  });

  test('Test 7: rejects non-localhost POST with 403', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '10.0.0.50',
      payload: {},
    });
    assert.equal(res.statusCode, 403);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, 'localhost_required');
  });
});

describe('GET /api/competitions/:id/event-codes', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    // Generate a code first
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 3: returns masked codes, never plaintext; includes id, masked_code, expires_at_ms, revoked_at_ms', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<{
      codes: Array<{
        id: string;
        masked_code: string;
        expires_at_ms: number;
        revoked_at_ms: number | null;
      }>;
    }>();
    assert.ok(Array.isArray(body.codes) && body.codes.length > 0, 'expected at least one code');
    for (const c of body.codes) {
      assert.ok(typeof c.id === 'string');
      assert.ok(typeof c.masked_code === 'string');
      // masked_code should contain **** and NOT be a full word-NNN pattern
      assert.ok(c.masked_code.includes('*'), `masked_code '${c.masked_code}' should be masked`);
      // full code should not be present in the response
      assert.ok(
        !c.masked_code.match(/^[a-zåäö]+-[1-9][0-9]{2}$/),
        'full plaintext code must not appear'
      );
      assert.ok(typeof c.expires_at_ms === 'number');
      assert.ok(c.revoked_at_ms === null || typeof c.revoked_at_ms === 'number');
    }
  });
});

describe('POST /api/competitions/:id/event-codes/:codeId/revoke', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('Test 4: revoke sets revoked_at_ms; subsequent validateCode returns null', async () => {
    const genRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    const { id: codeId, code } = genRes.json<{ id: string; code: string; expires_at_ms: number }>();

    // Validate before revoke — should be valid
    const beforeRevoke = await validateCode(ctx.handle, ctx.competitionId, code, Date.now());
    assert.ok(beforeRevoke !== null, 'code should be valid before revoke');

    const revokeRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes/${codeId}/revoke`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    assert.equal(revokeRes.statusCode, 200);

    // Validate after revoke — should be null
    const afterRevoke = await validateCode(ctx.handle, ctx.competitionId, code, Date.now());
    assert.equal(afterRevoke, null, 'code should be invalid after revoke');
  });

  test('Test 7: rejects non-localhost revoke with 403', async () => {
    const genRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes`,
      remoteAddress: '127.0.0.1',
      payload: {},
    });
    const { id: codeId } = genRes.json<{ id: string }>();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/event-codes/${codeId}/revoke`,
      remoteAddress: '192.168.1.50',
      payload: {},
    });
    assert.equal(res.statusCode, 403);
  });
});
