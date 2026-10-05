// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the MeOS integration password (D-MOP-4 / D-MIP-1,
// revised 2026-10-05). GET /mip hands out every entry and POST /mop adds
// runners, so neither may be open to the whole LAN by default:
//
//   - password set           → MeOS's `pwd` (header, or query) must match
//                              → else 401, from every machine.
//   - no password (default)  → this machine only (loopback / own
//                              interface addresses); the LAN gets 403.
//   - no password + explicit → open, as before.
//     "allow without password"

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../../server.ts';
import { openDatabase, type DbHandle } from '../../db/index.ts';
import { ensureNodeId } from '../../db/node-id.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPLETE_XML = readFileSync(
  path.join(__dirname, '__fixtures__', 'mop-complete-small.xml'),
  'utf8'
);

const LAN = '192.168.1.50';
const ENV_KEYS = ['MEOS_PASSWORD', 'MEOS_ALLOW_WITHOUT_PASSWORD'] as const;

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  savedEnv: Record<string, string | undefined>;
}

async function boot(): Promise<Ctx> {
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
  return { app, handle, savedEnv };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  ctx.handle.close();
  for (const k of ENV_KEYS) {
    if (ctx.savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = ctx.savedEnv[k];
  }
}

async function configure(
  ctx: Ctx,
  body: { meos_password?: string; meos_allow_without_password?: boolean }
): Promise<void> {
  const res = await ctx.app.inject({ method: 'PUT', url: '/api/settings/meos', payload: body });
  assert.equal(res.statusCode, 200, res.body);
}

function mip(ctx: Ctx, opts: { remoteAddress?: string; pwd?: string; queryPwd?: string } = {}) {
  return ctx.app.inject({
    method: 'GET',
    url: opts.queryPwd === undefined ? '/mip' : `/mip?pwd=${encodeURIComponent(opts.queryPwd)}`,
    remoteAddress: opts.remoteAddress ?? '127.0.0.1',
    headers: opts.pwd === undefined ? {} : { pwd: opts.pwd },
  });
}

function mop(ctx: Ctx, opts: { remoteAddress?: string; pwd?: string; queryPwd?: string } = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: opts.queryPwd === undefined ? '/mop' : `/mop?pwd=${encodeURIComponent(opts.queryPwd)}`,
    remoteAddress: opts.remoteAddress ?? '127.0.0.1',
    headers: {
      'content-type': 'application/xml',
      ...(opts.pwd === undefined ? {} : { pwd: opts.pwd }),
    },
    payload: COMPLETE_XML,
  });
}

const MOP_OK = /<MOPStatus status="OK"\/>/;

describe('MeOS integration access — default (no password, not allowed)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('localhost: /mip and /mop work', async () => {
    assert.equal((await mip(ctx)).statusCode, 200);
    const res = await mop(ctx);
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, MOP_OK);
  });

  test('LAN: /mip and /mop → 403 telling the operator to set a password', async () => {
    for (const res of [
      await mip(ctx, { remoteAddress: LAN }),
      await mop(ctx, { remoteAddress: LAN }),
    ]) {
      assert.equal(res.statusCode, 403);
      assert.match(res.payload, /lösenord/);
    }
  });
});

describe('MeOS integration access — explicitly allowed without password', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    await configure(ctx, { meos_allow_without_password: true });
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('LAN: /mip and /mop work, as before 2026-10-05', async () => {
    assert.equal((await mip(ctx, { remoteAddress: LAN })).statusCode, 200);
    const res = await mop(ctx, { remoteAddress: LAN });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, MOP_OK);
  });
});

describe('MeOS integration access — password set', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    // The allow flag does not open anything once a password is set.
    await configure(ctx, { meos_password: 'hemligt-123', meos_allow_without_password: true });
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('missing pwd → 401 on /mip and /mop, also from localhost', async () => {
    for (const remoteAddress of ['127.0.0.1', LAN]) {
      assert.equal((await mip(ctx, { remoteAddress })).statusCode, 401);
      assert.equal((await mop(ctx, { remoteAddress })).statusCode, 401);
    }
  });

  test('wrong pwd → 401 on /mip and /mop', async () => {
    for (const pwd of ['fel', 'hemligt-1234', '']) {
      assert.equal((await mip(ctx, { remoteAddress: LAN, pwd })).statusCode, 401, pwd);
      assert.equal((await mop(ctx, { remoteAddress: LAN, pwd })).statusCode, 401, pwd);
    }
  });

  test('right pwd header (as MeOS sends it) → /mip and /mop work from the LAN', async () => {
    assert.equal((await mip(ctx, { remoteAddress: LAN, pwd: 'hemligt-123' })).statusCode, 200);
    const res = await mop(ctx, { remoteAddress: LAN, pwd: 'hemligt-123' });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, MOP_OK);
  });

  test('right pwd query parameter → works too', async () => {
    assert.equal((await mip(ctx, { remoteAddress: LAN, queryPwd: 'hemligt-123' })).statusCode, 200);
    assert.equal((await mop(ctx, { remoteAddress: LAN, queryPwd: 'hemligt-123' })).statusCode, 200);
  });

  test('clearing the password returns to the default (LAN 403 unless allowed)', async () => {
    await configure(ctx, { meos_password: '', meos_allow_without_password: false });
    assert.equal((await mip(ctx, { remoteAddress: LAN })).statusCode, 403);
    assert.equal((await mip(ctx)).statusCode, 200);
  });
});

describe('MeOS integration access — password from the environment', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
    process.env['MEOS_PASSWORD'] = 'fran-env';
  });
  afterEach(async () => {
    await teardown(ctx);
  });

  test('MEOS_PASSWORD env wins, like the other secrets', async () => {
    assert.equal((await mip(ctx)).statusCode, 401);
    assert.equal((await mip(ctx, { pwd: 'fran-env' })).statusCode, 200);
  });
});
