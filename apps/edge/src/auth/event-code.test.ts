// Authored for fartola. Not ported from upstream.
//
// TDD tests for auth/event-code.ts and auth/event-code-wordlist.ts.
// Covers pure functions (generateCode, validateCode, signCookie, verifyCookie)
// and the locked 35-word Swedish O-feature wordlist.
//
// Plan 02.1-12, Task 1 (TDD RED → GREEN).
//
// Test 1:  generateCode matches ^[a-zåäö]+-[1-9][0-9]{2}$
// Test 2:  generateCode draws only from EVENT_CODE_WORDS; NNN in [100..999]
// Test 3:  validateCode returns row for valid active code
// Test 4:  validateCode returns null for expired code
// Test 5:  validateCode returns null for revoked code
// Test 6:  validateCode returns null for wrong competition_id
// Test 7:  signCookie + verifyCookie round-trip; competitionId in payload
// Test 8:  verifyCookie returns null for tampered cookie
// Test 9:  EVENT_CODE_WORDS.length === 35, no duplicates
// Test 10: validateCode rejects malformed inputs without DB query
// Test 11: verifyCookie returns null when cookie competitionId mismatches

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { EVENT_CODE_WORDS } from './event-code-wordlist.ts';
import {
  generateCode,
  validateCode,
  signCookie,
  verifyCookie,
  type EventCodeRow,
} from './event-code.ts';

interface Ctx {
  handle: DbHandle;
  tmpDir: string;
}

function boot(): Ctx {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'fartola-event-code-test-'));
  const dbPath = path.join(tmpDir, 'fartola.db');
  const handle = openDatabase(dbPath);
  ensureNodeId(handle);
  return { handle, tmpDir };
}

function teardown(ctx: Ctx): void {
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
}

/** Insert a minimal competition row so the FK constraint is satisfied. */
function insertCompetition(handle: DbHandle, competitionId: string): void {
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO competitions (id, name, date, created_at_ms)
       VALUES (?, ?, ?, ?)`
    )
    .run(competitionId, 'Test competition', '2026-05-24', Date.now());
}

function insertCode(
  handle: DbHandle,
  opts: {
    id?: string;
    competitionId?: string;
    code?: string;
    expiresAtMs?: number;
    revokedAtMs?: number | null;
  }
): EventCodeRow {
  const id = opts.id ?? crypto.randomUUID();
  const competitionId = opts.competitionId ?? 'comp-1';
  const code = opts.code ?? 'sänkan-127';
  const expiresAtMs = opts.expiresAtMs ?? Date.now() + 86_400_000;
  const revokedAtMs = opts.revokedAtMs ?? null;
  // Ensure parent competition exists for FK constraint.
  insertCompetition(handle, competitionId);
  handle.sqlite
    .prepare(
      `INSERT INTO event_codes (id, competition_id, code, expires_at_ms, revoked_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, competitionId, code, expiresAtMs, revokedAtMs, Date.now());
  return { id, competitionId, code, expiresAtMs, revokedAtMs };
}

const TEST_SECRET = 'test-secret-32-bytes-for-hmac-ok';

describe('event-code wordlist', () => {
  test('Test 9: EVENT_CODE_WORDS.length === 35, no duplicates', () => {
    assert.equal(EVENT_CODE_WORDS.length, 35, 'wordlist must have exactly 35 entries');
    const unique = new Set(EVENT_CODE_WORDS);
    assert.equal(unique.size, 35, 'wordlist must have no duplicates');
    for (const word of EVENT_CODE_WORDS) {
      assert.match(
        word,
        /^[a-zåäö]{3,}$/,
        `word '${word}' must match ^[a-zåäö]{3,}$ (lowercase Swedish incl å/ä/ö, min 3 chars)`
      );
    }
  });
});

describe('generateCode', () => {
  test('Test 1: returns string matching ^[a-zåäö]+-[1-9][0-9]{2}$', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode();
      assert.match(
        code,
        /^[a-zåäö]+-[1-9][0-9]{2}$/,
        `generateCode() returned '${code}' which does not match expected pattern`
      );
    }
  });

  test('Test 2: draws only from EVENT_CODE_WORDS; NNN in [100..999]; collision rate < 5%', () => {
    const N = 1000;
    const words = new Set<string>();
    const codes = new Set<string>();
    for (let i = 0; i < N; i++) {
      const code = generateCode();
      const dashIdx = code.lastIndexOf('-');
      const word = code.slice(0, dashIdx);
      const num = parseInt(code.slice(dashIdx + 1), 10);
      assert.ok(
        (EVENT_CODE_WORDS as readonly string[]).includes(word),
        `word '${word}' not in EVENT_CODE_WORDS`
      );
      assert.ok(num >= 100 && num <= 999, `number ${num} not in [100..999]`);
      words.add(word);
      codes.add(code);
    }
    const collisionRate = 1 - codes.size / N;
    assert.ok(
      collisionRate < 0.05,
      `collision rate ${collisionRate.toFixed(4)} >= 5% — randomness looks degenerate`
    );
  });
});

describe('validateCode', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = boot();
  });
  afterEach(() => {
    teardown(ctx);
  });

  test('Test 3: returns row for valid active code', async () => {
    const row = insertCode(ctx.handle, {
      competitionId: 'comp-1',
      code: 'sänkan-127',
    });
    const result = await validateCode(ctx.handle, 'comp-1', 'sänkan-127', Date.now());
    assert.ok(result !== null, 'expected non-null for valid code');
    assert.equal(result.id, row.id);
    assert.equal(result.code, 'sänkan-127');
  });

  test('Test 4: returns null for expired code (now > expires_at_ms)', async () => {
    insertCode(ctx.handle, {
      competitionId: 'comp-1',
      code: 'branten-403',
      expiresAtMs: Date.now() - 1000, // already expired
    });
    const result = await validateCode(ctx.handle, 'comp-1', 'branten-403', Date.now());
    assert.equal(result, null, 'expected null for expired code');
  });

  test('Test 5: returns null for revoked code', async () => {
    insertCode(ctx.handle, {
      competitionId: 'comp-1',
      code: 'röset-500',
      revokedAtMs: Date.now() - 500,
    });
    const result = await validateCode(ctx.handle, 'comp-1', 'röset-500', Date.now());
    assert.equal(result, null, 'expected null for revoked code');
  });

  test('Test 6: returns null for wrong competition_id', async () => {
    insertCode(ctx.handle, {
      competitionId: 'comp-A',
      code: 'bron-555',
    });
    const result = await validateCode(ctx.handle, 'comp-B', 'bron-555', Date.now());
    assert.equal(result, null, 'expected null for mismatched competition_id');
  });

  test('Test 10: rejects malformed inputs without DB query', async () => {
    // Insert a valid row to make sure any bypass would return it
    insertCode(ctx.handle, { competitionId: 'comp-1', code: 'sänkan-007' });

    const malformed = [
      'sänkan-007', // zero-padded
      'sänkan-99', // 2 digits
      'sänkan-1000', // 4 digits
      'sänkan42', // missing dash
      'Sänkan-127', // uppercase
      'SÄNKAN-127', // all caps
    ];
    for (const code of malformed) {
      const result = await validateCode(ctx.handle, 'comp-1', code, Date.now());
      assert.equal(result, null, `expected null for malformed code '${code}'`);
    }
  });
});

describe('signCookie + verifyCookie', () => {
  test('Test 7: round-trip — signCookie produces string; verifyCookie returns payload with competitionId', () => {
    const competitionId = 'comp-xyz';
    const expiresAt = Date.now() + 86_400_000;
    const cookie = signCookie(competitionId, TEST_SECRET, expiresAt);
    assert.equal(typeof cookie, 'string', 'signCookie must return a string');
    assert.ok(cookie.includes('.'), 'cookie must contain dot separator');

    const payload = verifyCookie(cookie, competitionId, TEST_SECRET);
    assert.ok(payload !== null, 'verifyCookie must return payload for valid cookie');
    assert.equal(payload.competitionId, competitionId);
    assert.ok(payload.expiresAt === expiresAt);
  });

  test('Test 8: verifyCookie returns null for tampered cookie (single char flip in signature)', () => {
    const cookie = signCookie('comp-1', TEST_SECRET, Date.now() + 86_400_000);
    const [payloadPart, sigPart] = cookie.split('.');
    // Flip one character in the signature
    const tamperedSig = sigPart.slice(0, -1) + (sigPart.at(-1) === 'a' ? 'b' : 'a');
    const tamperedCookie = `${payloadPart}.${tamperedSig}`;
    const result = verifyCookie(tamperedCookie, 'comp-1', TEST_SECRET);
    assert.equal(result, null, 'expected null for tampered cookie');
  });

  test('Test 11: verifyCookie returns null when cookie competitionId mismatches provided competitionId', () => {
    const cookie = signCookie('comp-A', TEST_SECRET, Date.now() + 86_400_000);
    // Cookie was signed for comp-A but we verify against comp-B
    const result = verifyCookie(cookie, 'comp-B', TEST_SECRET);
    assert.equal(result, null, 'expected null for competitionId mismatch');
  });
});
