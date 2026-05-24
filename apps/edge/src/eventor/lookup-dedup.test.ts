// Authored for fartola. Not ported from upstream.
//
// Plan 02.1-10 Task 2 — TDD tests for tri-state lookupBySiCard with
// context-aware disambiguation.
//
// Tests 1-8 from the plan behavior spec (adjusted for recency-only algorithm):
//   Test 1: unique card → hit with alternatives: 0
//   Test 2: duplicate cards, no context → recency winner, alternatives: N-1
//   Test 3: duplicate cards + active competition (context accepted but not used) → recency winner
//   Test 4: duplicate cards + active competition matching none → recency winner
//   Test 5: no match → miss
//   Test 6: GET /api/eventor/lookup returns tri-state shape (route test)
//   Test 7: WalkupModal renders +N andra chip when alternatives > 0 (frontend)
//   Test 8: recency-tie with three candidates (two tied) → 'many'
//
// Test 7 is a UI test covered in the frontend; we verify the API contract
// that supplies the alternatives count here (backend unit tests only).
//
// DEVIATION: Tests 3, 6c, and 8 were revised from the plan spec because
// competition-context disambiguation requires competitors.eventor_person_id FK
// which does not exist in the current schema. See Plan 02.1-10 SUMMARY.md
// deviation notes. The activeCompetitionId parameter is accepted but reserved.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-10-PLAN.md Task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { buildServer } from '../server.ts';
import { ingestEventorCache } from './cache.ts';
import { competitors, competitions, classes, eventorCompetitors } from '../db/schema.ts';
import { lookupBySiCard, type EventorLookupResult } from './lookup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.join(__dirname, '__fixtures__');
const SHARED_CARD_XML = path.join(FIX_DIR, 'competitors-shared-card.xml');
const CLUBS_XML = path.join(FIX_DIR, 'clubs-sample.xml');

// ---------------------------------------------------------------------------
// Helper: open an in-memory DB and seed it with the shared-card fixture.
// Returns the handle. Caller must close.
// ---------------------------------------------------------------------------
async function withSharedCardDb(): Promise<DbHandle> {
  const handle = openDatabase(':memory:');
  await ingestEventorCache(handle, SHARED_CARD_XML, CLUBS_XML, 1_700_000_000_000);
  return handle;
}

// ---------------------------------------------------------------------------
// Helper: create a minimal competition + class + competitor row in the local
// competitors table (so context-aware disambiguation can join against it).
// ---------------------------------------------------------------------------
function seedLocalCompetitor(
  handle: DbHandle,
  opts: {
    competitionId: string;
    personId: number;
    name: string;
    cardNumber: number;
    classId: string;
  }
): void {
  // Ensure competition exists.
  handle.db
    .insert(competitions)
    .values({
      id: opts.competitionId,
      name: 'Test Competition',
      date: '2024-01-01',
      createdAtMs: 0,
    })
    .onConflictDoNothing()
    .run();
  // Ensure class exists.
  handle.db
    .insert(classes)
    .values({
      id: opts.classId,
      competitionId: opts.competitionId,
      name: 'D21',
    })
    .onConflictDoNothing()
    .run();
  // Insert competitor.
  handle.db
    .insert(competitors)
    .values({
      id: `comp-${opts.personId}`,
      competitionId: opts.competitionId,
      name: opts.name,
      classId: opts.classId,
      cardNumber: opts.cardNumber,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Tests 1-5: unit-level lookupBySiCard.
// ---------------------------------------------------------------------------

describe('lookupBySiCard — tri-state with context-aware disambiguation', () => {
  test('Test 1: unique card → hit with alternatives: 0', async () => {
    const handle = await withSharedCardDb();
    try {
      // si_card 7777777 belongs only to Solo Ensamme (person 1003)
      const res = lookupBySiCard(handle, 7_777_777, null);
      assert.equal(res.hit, true, 'unique card must resolve to hit: true');
      assert.equal(
        (res as { alternatives: number }).alternatives,
        0,
        'unique card must have alternatives: 0'
      );
      assert.equal((res as { person_id: number }).person_id, 1003);
    } finally {
      handle.close();
    }
  });

  test('Test 2: duplicate cards, no context → recency winner, alternatives: N-1', async () => {
    const handle = await withSharedCardDb();
    try {
      // si_card 8410001 is shared by Alfa (modifyDateMs=2023) and Beta (modifyDateMs=2024).
      // No active competition context — recency rule picks Beta (higher modifyDateMs).
      const res = lookupBySiCard(handle, 8_410_001, null);
      assert.equal(res.hit, true, 'recency-resolved duplicate must resolve to hit: true');
      assert.equal(
        (res as { alternatives: number }).alternatives,
        1,
        'must report alternatives: 1 (one other candidate)'
      );
      // Beta has the most recent modifyDateMs (2024 > 2023) → wins.
      assert.equal(
        (res as { given_name: string }).given_name,
        'Beta',
        'Beta (most recent) must win the recency rule'
      );
    } finally {
      handle.close();
    }
  });

  test('Test 3: duplicate cards + activeCompetitionId accepted but ignored → recency winner', async () => {
    const handle = await withSharedCardDb();
    const COMP_ID = 'comp-abc';
    const CLASS_ID = 'cls-d21';
    try {
      // Register Alfa (person 1001) in the active competition with card 8410001.
      // Beta (person 1002) is NOT registered in this competition.
      // DEVIATION: competition context is accepted but NOT used for disambiguation
      // (no eventor_person_id FK in competitors table). Recency rule still picks
      // Beta (modifyDateMs 2024 > 2023). See SUMMARY.md deviation notes.
      seedLocalCompetitor(handle, {
        competitionId: COMP_ID,
        personId: 1001,
        name: 'Alfa Familjen',
        cardNumber: 8_410_001,
        classId: CLASS_ID,
      });

      const res = lookupBySiCard(handle, 8_410_001, COMP_ID);
      assert.equal(res.hit, true, 'recency rule must resolve to hit: true');
      assert.equal(
        (res as { given_name: string }).given_name,
        'Beta',
        'Beta (most recent modifyDateMs) wins via recency rule regardless of competition context'
      );
      // One alternative still exists (Alfa).
      assert.equal((res as { alternatives: number }).alternatives, 1);
    } finally {
      handle.close();
    }
  });

  test('Test 4: duplicate cards + active competition matching none → recency winner', async () => {
    const handle = await withSharedCardDb();
    const COMP_ID = 'comp-xyz';
    const CLASS_ID = 'cls-h40';
    try {
      // A different competition with a different competitor (not Alfa or Beta).
      seedLocalCompetitor(handle, {
        competitionId: COMP_ID,
        personId: 9999,
        name: 'Stranger Person',
        cardNumber: 99999,
        classId: CLASS_ID,
      });

      // Now look up card 8410001 with a competition that matches neither Alfa nor Beta.
      const res = lookupBySiCard(handle, 8_410_001, COMP_ID);
      assert.equal(res.hit, true, 'no-context-match falls through to recency rule → hit: true');
      assert.equal(
        (res as { given_name: string }).given_name,
        'Beta',
        'Beta (most recent) wins recency fallback'
      );
      assert.equal((res as { alternatives: number }).alternatives, 1);
    } finally {
      handle.close();
    }
  });

  test('Test 5: no match → miss', async () => {
    const handle = await withSharedCardDb();
    try {
      const res = lookupBySiCard(handle, 99_999_999, null);
      assert.equal(res.hit, false, 'unknown card must return miss shape');
    } finally {
      handle.close();
    }
  });

  test('Test 8: exact recency tie among top candidates → many (operator must pick)', async () => {
    // DEVIATION from plan: Test 8 was originally "same-competition shared card → many"
    // which required competitors.eventor_person_id FK (not available). Replaced with
    // a recency-tie scenario that exercises the 'many' return path without that FK.
    //
    // The shared-card fixture has Alfa (2023) and Beta (2024). We insert a third
    // candidate "Gamma" with the SAME modifyDateMs as Beta → tie at the top →
    // recency rule cannot pick a single winner → 'many'.
    const handle = await withSharedCardDb();
    try {
      // Read Beta's modifyDateMs from the seeded DB.
      const betaRow = handle.sqlite
        .prepare<
          [],
          { v: number }
        >(`SELECT modify_date_ms AS v FROM eventor_competitors WHERE given_name = 'Beta'`)
        .get();
      const betaMs = betaRow?.v ?? 0;

      // Insert Gamma with same modifyDateMs as Beta → tie at the top.
      handle.db
        .insert(eventorCompetitors)
        .values({
          personId: 1004,
          familyName: 'Familjen',
          givenName: 'Gamma',
          clubId: null,
          siCard: 8_410_001,
          emitCard: null,
          modifyDateMs: betaMs,
        })
        .run();

      // 3 candidates: Alfa (older), Beta (tied top), Gamma (tied top) → many.
      const res = lookupBySiCard(handle, 8_410_001, null);
      assert.equal(res.hit, 'many', 'recency tie must return many (not a single hit)');
      const candidates = (res as { candidates: Array<{ given_name: string }> }).candidates;
      assert.equal(candidates.length, 3, 'all three candidates must be listed');
      const names = candidates.map((c) => c.given_name).sort();
      assert.deepEqual(names, ['Alfa', 'Beta', 'Gamma']);
    } finally {
      handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests 3 & 6: route-level — GET /api/eventor/lookup passes competition_id.
// ---------------------------------------------------------------------------

describe('GET /api/eventor/lookup — tri-state route', () => {
  let ctx: { app: FastifyInstance; handle: DbHandle };

  beforeEach(async () => {
    const handle = await withSharedCardDb();
    const nodeId = ensureNodeId(handle);
    const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
    ctx = { app, handle };
  });

  afterEach(async () => {
    await ctx.app.close();
    try {
      ctx.handle.close();
    } catch {
      /* already closed */
    }
  });

  test('Test 6a: si_card unique → 200 with hit: true and alternatives: 0', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/eventor/lookup?si_card=7777777',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as EventorLookupResult;
    assert.equal(body.hit, true);
    assert.equal((body as { alternatives: number }).alternatives, 0);
  });

  test('Test 6b: si_card duplicate, no competition_id → recency hit', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/eventor/lookup?si_card=8410001',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as EventorLookupResult;
    assert.equal(body.hit, true);
    assert.equal((body as { given_name: string }).given_name, 'Beta');
    assert.equal((body as { alternatives: number }).alternatives, 1);
  });

  test('Test 6c: competition_id passed → route accepts it, recency still wins', async () => {
    // DEVIATION from plan: competition_id is accepted by the route but not used for
    // disambiguation (no eventor_person_id FK). Recency rule still picks Beta.
    const COMP_ID = 'comp-route-test';
    const CLASS_ID = 'cls-route-test';
    // Seed Alfa (not Beta) in the active competition.
    seedLocalCompetitor(ctx.handle, {
      competitionId: COMP_ID,
      personId: 1001,
      name: 'Alfa Familjen',
      cardNumber: 8_410_001,
      classId: CLASS_ID,
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/eventor/lookup?si_card=8410001&competition_id=${COMP_ID}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as EventorLookupResult;
    assert.equal(body.hit, true);
    // Beta (most recent modifyDateMs) wins regardless of competition_id param.
    assert.equal((body as { given_name: string }).given_name, 'Beta');
  });
});
