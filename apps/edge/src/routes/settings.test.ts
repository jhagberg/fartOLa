// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET + PUT /api/settings/integrations (Plan
// 02-07 task 1). Validates the 7 behaviors locked in the plan:
//
//   1. GET with EVENTOR_API_KEY in process.env → set:true, source:env,
//      value field MUST be absent (write-only secret).
//   2. GET with no env var + a config row → set:true, source:config,
//      value still absent.
//   3. GET with neither env nor config → set:false, source:absent.
//   4. PUT { key, value } writes to config; subsequent GET reflects
//      source:config / set:true.
//   5. PUT with empty string value deletes the config row.
//   6. PUT with key NOT in the integrations allowlist → 400 (prevents
//      arbitrary config writes via this REST surface).
//   7. PUT request body's `value` field is REDACTED by pino — captured
//      via fastify.log writes against a stream sink. AUDIT-CANARY must
//      not appear in any captured log line.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 1
// - OWASP A02:2021 (write-only secret field)

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { config as configTable } from '../db/schema.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  logChunks: string[];
}

async function boot(loggerOn = false): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const logChunks: string[] = [];
  // When loggerOn is true, capture pino output to an in-memory stream
  // so the redaction test can inspect what actually got written.
  // Pino's typed stream-only shape from FastifyServerOptions['logger']
  // doesn't surface in this TS path; route through Record<string,unknown>
  // (the buildServer override accepts that shape) and ESLint stays happy.
  const loggerOpt: Record<string, unknown> = {
    level: 'info',
    stream: new Writable({
      write(chunk: Buffer, _enc, cb): void {
        logChunks.push(chunk.toString('utf8'));
        cb();
      },
    }),
  };
  const app = loggerOn
    ? await buildServer({ logger: loggerOpt, dbHandle: handle, nodeId })
    : await buildServer({ logger: false, dbHandle: handle, nodeId });
  return { app, handle, logChunks };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
}

describe('GET /api/settings/integrations', () => {
  const SAVED_KEY = process.env['EVENTOR_API_KEY'];
  let ctx: Ctx;

  beforeEach(async () => {
    delete process.env['EVENTOR_API_KEY'];
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
    if (SAVED_KEY === undefined) delete process.env['EVENTOR_API_KEY'];
    else process.env['EVENTOR_API_KEY'] = SAVED_KEY;
  });

  test('Test 1: env var set → set:true, source:env, value ABSENT', async () => {
    process.env['EVENTOR_API_KEY'] = 'FROM-ENV-DO-NOT-LEAK';
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/integrations',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      integrations: Array<{ key: string; set: boolean; source: string; value?: unknown }>;
    };
    const row = body.integrations.find((r) => r.key === 'EVENTOR_API_KEY');
    assert.ok(row, 'EVENTOR_API_KEY row must be present');
    assert.equal(row.set, true);
    assert.equal(row.source, 'env');
    assert.equal(row.value, undefined, 'value field MUST never be returned (write-only)');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(row, 'value'),
      'value field MUST be absent from the response object'
    );
    // Also assert the response body text never contains the actual key
    // — the field-absent test above isn't enough if a future regression
    // shows up at a different key.
    assert.ok(
      !res.body.includes('FROM-ENV-DO-NOT-LEAK'),
      'response body MUST NOT contain the env-var value'
    );
  });

  test('Test 2: no env, config row exists → set:true, source:config, value ABSENT', async () => {
    ctx.handle.db
      .insert(configTable)
      .values({ key: 'EVENTOR_API_KEY', value: 'FROM-CONFIG-DO-NOT-LEAK' })
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/integrations',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      integrations: Array<{ key: string; set: boolean; source: string; value?: unknown }>;
    };
    const row = body.integrations.find((r) => r.key === 'EVENTOR_API_KEY');
    assert.ok(row);
    assert.equal(row.set, true);
    assert.equal(row.source, 'config');
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'value'));
    assert.ok(!res.body.includes('FROM-CONFIG-DO-NOT-LEAK'));
  });

  test('Test 3: neither env nor config → set:false, source:absent', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/integrations',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      integrations: Array<{ key: string; set: boolean; source: string }>;
    };
    const row = body.integrations.find((r) => r.key === 'EVENTOR_API_KEY');
    assert.ok(row);
    assert.equal(row.set, false);
    assert.equal(row.source, 'absent');
  });

  test('GET returns ALL allowlisted integrations (forward-compat shape)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/integrations',
    });
    const body = res.json() as { integrations: Array<{ key: string }> };
    const keys = body.integrations.map((r) => r.key);
    // Plan task-1 truth: allowlist includes EVENTOR_API_KEY plus Phase 3
    // placeholders. Listing them upfront means Plan 03 only wires
    // boot.ts; no schema change needed when LIVELOX / LIVERESULTAT land.
    assert.ok(keys.includes('EVENTOR_API_KEY'));
    assert.ok(keys.includes('LIVELOX_API_KEY'));
    assert.ok(keys.includes('LIVERESULTAT_API_KEY'));
  });
});

describe('PUT /api/settings/integrations', () => {
  const SAVED_KEY = process.env['EVENTOR_API_KEY'];
  let ctx: Ctx;

  beforeEach(async () => {
    delete process.env['EVENTOR_API_KEY'];
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
    if (SAVED_KEY === undefined) delete process.env['EVENTOR_API_KEY'];
    else process.env['EVENTOR_API_KEY'] = SAVED_KEY;
  });

  test('Test 4: PUT writes to config; GET reflects source:config / set:true', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { key: 'EVENTOR_API_KEY', value: 'TEST-KEY-PERSIST' },
    });
    assert.equal(put.statusCode, 200);
    const putBody = put.json() as { ok: boolean; key: string; set: boolean; source: string };
    assert.equal(putBody.ok, true);
    assert.equal(putBody.key, 'EVENTOR_API_KEY');
    assert.equal(putBody.set, true);
    assert.equal(putBody.source, 'config');

    // Confirm the row landed in the config table.
    const row = ctx.handle.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, 'EVENTOR_API_KEY'))
      .get();
    assert.equal(row?.value, 'TEST-KEY-PERSIST');

    const get = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/integrations',
    });
    const getBody = get.json() as {
      integrations: Array<{ key: string; set: boolean; source: string }>;
    };
    const ev = getBody.integrations.find((r) => r.key === 'EVENTOR_API_KEY');
    assert.equal(ev?.set, true);
    assert.equal(ev?.source, 'config');
  });

  test('Test 5: PUT with empty-string value DELETES the config row', async () => {
    // First seed a value.
    ctx.handle.db
      .insert(configTable)
      .values({ key: 'EVENTOR_API_KEY', value: 'SEED' })
      .onConflictDoUpdate({ target: configTable.key, set: { value: 'SEED' } })
      .run();

    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { key: 'EVENTOR_API_KEY', value: '' },
    });
    assert.equal(put.statusCode, 200);
    const putBody = put.json() as { ok: boolean; set: boolean; source: string };
    assert.equal(putBody.set, false);
    assert.equal(putBody.source, 'absent');

    // Row must be gone from the DB.
    const row = ctx.handle.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, 'EVENTOR_API_KEY'))
      .get();
    assert.equal(row, undefined, 'row should be deleted after empty-string PUT');
  });

  test('Test 6: PUT with unknown key returns 400 (allowlist gate)', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { key: 'NOT_AN_INTEGRATION_KEY', value: 'whatever' },
    });
    assert.equal(put.statusCode, 400);
    const body = put.json() as { error?: string };
    assert.equal(body.error, 'unknown_integration_key');
  });

  test('PUT with missing or non-string key returns 400', async () => {
    const r1 = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { value: 'x' },
    });
    assert.equal(r1.statusCode, 400);
    const r2 = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { key: 'EVENTOR_API_KEY', value: 12345 },
    });
    assert.equal(r2.statusCode, 400);
  });

  test('PUT with malformed JSON body does NOT echo the body back', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      headers: { 'content-type': 'application/json' },
      payload: '{ "key": "EVENTOR_API_KEY", "value": "LEAKED-CANARY-XYZ" malformed }',
    });
    // 400 is fine; the gate is: the response body MUST NOT contain
    // the canary value (manual audit task-4 contract).
    assert.ok(res.statusCode >= 400 && res.statusCode < 500);
    assert.ok(
      !res.body.includes('LEAKED-CANARY-XYZ'),
      'error response MUST NOT echo the request body'
    );
  });
});

describe('PUT /api/settings/integrations — pino log redaction (Test 7)', () => {
  const SAVED_KEY = process.env['EVENTOR_API_KEY'];
  let ctx: Ctx;

  beforeEach(async () => {
    delete process.env['EVENTOR_API_KEY'];
    ctx = await boot(true /* logger on, capture stream */);
  });

  afterEach(async () => {
    await teardown(ctx);
    if (SAVED_KEY === undefined) delete process.env['EVENTOR_API_KEY'];
    else process.env['EVENTOR_API_KEY'] = SAVED_KEY;
  });

  test('Test 7: pino logger output does NOT contain the PUT body value', async () => {
    // Send a recognisable canary. After the request, scan EVERY chunk
    // captured by the stream sink — the canary must never appear.
    const CANARY = 'AUDIT-CANARY-PINO-12345';

    // Fastify's default `req` serializer flattens to method/url/host and
    // intentionally DROPS req.body — so the body never reaches the log
    // stream via the standard incoming-request/response-completed lines.
    // That's the project's first line of defence.
    //
    // Plan task-1 truth #4 also requires defence-in-depth: if a future
    // handler (or a debug-paste from a stressed operator) explicitly
    // logs the payload via `app.log.info({ body: ... }, 'msg')`, the
    // redact path list MUST scrub the `value` field before it hits
    // stdout. The next two log lines exercise the `body.value` envelopes
    // the redact list covers (after Gemini review #10 narrowed the
    // contract — a bare top-level `value` field is intentionally NOT
    // redacted so unrelated debug data like `log.info({ value: 42 })`
    // stays observable).

    // Pattern A: log the inbound payload as `{ body }`.
    ctx.app.log.info({ body: { key: 'EVENTOR_API_KEY', value: CANARY } }, 'pattern A');
    // Pattern B: nested under a `request` envelope (matches the
    // `request.body.value` redact path).
    ctx.app.log.info({ request: { body: { key: 'EVENTOR_API_KEY', value: CANARY } } }, 'pattern B');

    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/integrations',
      payload: { key: 'EVENTOR_API_KEY', value: CANARY },
    });
    assert.equal(res.statusCode, 200);

    // Give pino a tick to flush. node:test runs synchronously by default
    // but pino's stream write is async on the next microtask.
    await new Promise((r) => setTimeout(r, 50));

    const joined = ctx.logChunks.join('');
    assert.ok(joined.length > 0, 'expected SOME log output to assert against');
    assert.ok(
      !joined.includes(CANARY),
      `pino log MUST NOT contain canary value. Captured logs:\n${joined}`
    );
    // Sanity: redaction marker SHOULD appear at least twice (once per
    // synthetic log line that contains a `body.value` field). If it
    // doesn't, the redact paths are wrong and the canary-absence test
    // above is probably succeeding by coincidence.
    const redactCount = (joined.match(/\[REDACTED\]/g) ?? []).length;
    assert.ok(
      redactCount >= 2,
      `expected pino [REDACTED] marker at least twice (saw ${redactCount}). Captured:\n${joined}`
    );
  });
});

// D-MOP-4 / D-MIP-1 revised 2026-10-05: the MeOS integration password. Write-
// only like the API keys: the GET says whether one is set, never what it is.
describe('GET/PUT /api/settings/meos', () => {
  const ENV_KEYS = ['MEOS_PASSWORD', 'MEOS_ALLOW_WITHOUT_PASSWORD'] as const;
  const saved: Record<string, string | undefined> = {};
  let ctx: Ctx;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    ctx = await boot(true /* logger on, capture stream */);
  });

  afterEach(async () => {
    await teardown(ctx);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const get = async (): Promise<Record<string, unknown>> => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/settings/meos' });
    assert.equal(res.statusCode, 200);
    return res.json<Record<string, unknown>>();
  };
  const put = (payload: unknown) =>
    ctx.app.inject({ method: 'PUT', url: '/api/settings/meos', payload: payload as object });

  test('default: no password, not allowed without one', async () => {
    assert.deepEqual(await get(), { has_meos_password: false, meos_allow_without_password: false });
  });

  // Codex third review of #51, finding 5: the flags tell the LAN whether
  // /mip and /mop are open; only the operator machine may read them.
  test('GET from the LAN → 403 operator_only; from localhost → 200', async () => {
    const lan = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/meos',
      remoteAddress: '192.168.1.50',
    });
    assert.equal(lan.statusCode, 403);
    assert.deepEqual(lan.json(), { error: 'operator_only' });
    const local = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/meos',
      remoteAddress: '127.0.0.1',
    });
    assert.equal(local.statusCode, 200);
  });

  test('PUT a password → has_meos_password; the password is never returned', async () => {
    const CANARY = 'MEOS-CANARY-PWD-777';
    const res = await put({ meos_password: CANARY });
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes(CANARY));
    const body = await get();
    assert.deepEqual(body, { has_meos_password: true, meos_allow_without_password: false });
    assert.ok(!JSON.stringify(body).includes(CANARY));
    await new Promise((r) => setTimeout(r, 50));
    ctx.app.log.info({ body: { meos_password: CANARY } }, 'debug paste');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!ctx.logChunks.join('').includes(CANARY), 'pino log must not contain the password');
  });

  test('PUT empty password clears it; the allow flag is stored separately', async () => {
    await put({ meos_password: 'x', meos_allow_without_password: true });
    assert.deepEqual(await get(), { has_meos_password: true, meos_allow_without_password: true });
    await put({ meos_password: '' });
    assert.deepEqual(await get(), { has_meos_password: false, meos_allow_without_password: true });
    await put({ meos_allow_without_password: false });
    assert.deepEqual(await get(), { has_meos_password: false, meos_allow_without_password: false });
  });

  test('invalid body → 400', async () => {
    for (const payload of [
      { meos_password: 42 },
      { meos_allow_without_password: 'yes' },
      { meos_password: 'x'.repeat(513) },
      { other: 1 },
    ]) {
      assert.equal((await put(payload)).statusCode, 400, JSON.stringify(payload));
    }
  });
});
