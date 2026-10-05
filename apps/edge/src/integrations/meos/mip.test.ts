// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET /mip (Plan 02-03). Validates:
//
//   - Test 0a: bundled mip-empty.xml fixture is XSD-valid against mip.xsd.
//   - Test 0b: bundled mip-entry-plain.xml fixture is XSD-valid against mip.xsd.
//   - Test 0c: bundled mip-entry-hired.xml fixture is XSD-valid against mip.xsd.
//   - Test 1: GET /mip with no active_competition_id returns 200
//     <MIPData xmlns lastid="0"/> AND is XSD-valid.
//   - Test 2: GET /mip with active_competition_id set but no card_bound
//     events echoes the input lastid.
//   - Test 3: walk-up registration → GET /mip?lastid=0 returns exactly one
//     <entry> with @_id=localSeq, @_extId=UUID, @_classname=class name,
//     name + club + card (no hired flag). XSD-valid.
//   - Test 4: walk-up registration with hired_card=true → <card hired="true">12345</card>.
//   - Test 5: 5 walk-ups with local_seq 1..5 → GET /mip?lastid=3 returns
//     exactly 2 entries (seq 4 + 5); response lastid = 5.
//   - Test 6: no password set → pwd ignored from this machine (the password
//     cases are in access.test.ts; D-MIP-1 revised 2026-10-05).
//   - Test 7: query param wins over header.
//   - Test 8: garbage lastid → 400 with structured error.
//   - Test 9 (Task 3 / D-MIP-3): card-replace re-emit round-trip — same
//     extId in re-emitted entry, new card_number.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-03-PLAN.md task 2 + 3
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 3: MIP GET /mip Fastify route"
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"MIP XSD-conformance round-trip"
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Landmines" — MIP
//   lastid strictly increasing; input.php lastid coercion; <name> required.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { validateXML } from 'xmllint-wasm';

import { buildServer } from '../../server.ts';
import { openDatabase, type DbHandle } from '../../db/index.ts';
import { ensureNodeId } from '../../db/node-id.ts';
import { config as configTable, hiredCards } from '../../db/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIP_XSD = readFileSync(path.join(__dirname, 'mip.xsd'), 'utf8');
const FIX_DIR = path.join(__dirname, '__fixtures__');

/** Helper — validate one inline XML string against the bundled mip.xsd. */
async function expectXsdValid(xml: string, fileName = 'mip.xml'): Promise<void> {
  const result = await validateXML({
    xml: [{ fileName, contents: xml }],
    schema: [{ fileName: 'mip.xsd', contents: MIP_XSD }],
  });
  if (!result.valid) {
    const errs = result.errors.map((e) => e.message ?? e.rawMessage).join('\n');
    assert.fail(`XSD validation failed:\n${errs}\nXML:\n${xml}`);
  }
}

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

/** Seed competition + class + active_competition_id in one shot. Returns the
 * ids the test needs to bind walk-ups to. */
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

  // Mark this competition as the active one so /mip serves it.
  const setRes = await ctx.app.inject({
    method: 'POST',
    url: '/api/sessions/active-competition',
    payload: { competition_id: competitionId },
  });
  assert.equal(setRes.statusCode, 200);

  return { competitionId, classId };
}

// ============================================================================
// Fixture XSD validation
// ============================================================================

describe('MIP fixtures vs bundled mip.xsd', () => {
  test('test 0a: mip-empty.xml is XSD-valid', async () => {
    const xml = readFileSync(path.join(FIX_DIR, 'mip-empty.xml'), 'utf8');
    await expectXsdValid(xml, 'mip-empty.xml');
  });

  test('test 0b: mip-entry-plain.xml is XSD-valid', async () => {
    const xml = readFileSync(path.join(FIX_DIR, 'mip-entry-plain.xml'), 'utf8');
    await expectXsdValid(xml, 'mip-entry-plain.xml');
  });

  test('test 0c: mip-entry-hired.xml is XSD-valid', async () => {
    const xml = readFileSync(path.join(FIX_DIR, 'mip-entry-hired.xml'), 'utf8');
    await expectXsdValid(xml, 'mip-entry-hired.xml');
  });
});

// ============================================================================
// GET /mip
// ============================================================================

describe('GET /mip — integrations/meos/mip', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  test('test 1: no active_competition_id → 200 <MIPData lastid="0"/> XSD-valid', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/mip' });
    assert.equal(res.statusCode, 200);
    const ct = res.headers['content-type'] ?? '';
    assert.ok(String(ct).startsWith('application/xml'));
    const body = res.payload;
    assert.match(body, /<MIPData[^>]+xmlns="http:\/\/www\.melin\.nu\/mip"/);
    assert.match(body, /lastid="0"/);
    // Empty: no <entry> children.
    assert.equal(/<entry\b/.test(body), false);
    await expectXsdValid(body);
  });

  test('test 2: active_competition_id set but no events → echoes input lastid', async () => {
    await seedActiveCompetition(ctx);
    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=42' });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /lastid="42"/);
    assert.equal(/<entry\b/.test(res.payload), false);
    await expectXsdValid(res.payload);
  });

  test('test 3: single walk-up → one <entry> with extId/classname/name/club/card; XSD-valid', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx);
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Hagberg, Jonas',
        club: 'Stora Tuna OK',
        class_id: classId,
        card_number: 12345,
        consent: true,
      },
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json() as { id: string };

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(res.statusCode, 200);
    const body = res.payload;
    await expectXsdValid(body);

    // Exactly one <entry>.
    const entryMatches = body.match(/<entry\b/g) ?? [];
    assert.equal(entryMatches.length, 1);
    // Attributes.
    assert.match(body, new RegExp(`extId="${created.id}"`));
    assert.match(body, /classname="Vit"/);
    // Children.
    assert.match(body, /<name>Hagberg, Jonas<\/name>/);
    assert.match(body, /<club>Stora Tuna OK<\/club>/);
    // <card> WITHOUT @hired (Test 3 is a plain walk-up).
    assert.match(body, /<card>12345<\/card>/);
    // lastid must be at least the entry's id (== local_seq).
    const lastidMatch = body.match(/lastid="(\d+)"/);
    assert.ok(lastidMatch && lastidMatch[1]);
    const lastid = Number.parseInt(lastidMatch[1] as string, 10);
    assert.ok(lastid >= 1);
  });

  test('test 4: walk-up with hired_card=true → <card hired="true">N</card>; XSD-valid', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx);
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Renter, Rita',
        club: 'Stora Tuna OK',
        class_id: classId,
        card_number: 22222,
        consent: true,
        hired_card: true,
        hired_contact: { name: 'Rita', phone: '+46700000000', email: null, note: null },
      },
    });
    assert.equal(createRes.statusCode, 201);

    // Sanity: hired_cards row exists.
    const hcRows = ctx.handle.db.select().from(hiredCards).all();
    assert.equal(hcRows.length, 1);

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(res.statusCode, 200);
    const body = res.payload;
    await expectXsdValid(body);
    assert.match(body, /<card hired="true">22222<\/card>/);
  });

  test('test 5: lastid=3 filter on 5 card_bound events → 2 entries; response lastid=5', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx);
    for (let i = 1; i <= 5; i++) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: {
          competition_id: competitionId,
          name: `R${i}`,
          club: null,
          class_id: classId,
          card_number: 100000 + i,
          consent: true,
        },
      });
      assert.equal(r.statusCode, 201);
    }

    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=3' });
    assert.equal(res.statusCode, 200);
    const body = res.payload;
    await expectXsdValid(body);
    const entryMatches = body.match(/<entry\b/g) ?? [];
    assert.equal(entryMatches.length, 2);
    // Response lastid = max returned (= 5).
    assert.match(body, /lastid="5"/);
  });

  test('test 6: no password set, localhost — a pwd query param is ignored, 200', async () => {
    const res1 = await ctx.app.inject({ method: 'GET', url: '/mip' });
    const res2 = await ctx.app.inject({ method: 'GET', url: '/mip?pwd=anything' });
    assert.equal(res1.statusCode, 200);
    assert.equal(res2.statusCode, 200);
    assert.equal(res1.payload, res2.payload);
  });

  test('test 7: query lastid wins over X-Lastid header', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx);
    for (let i = 1; i <= 5; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/competitors',
        payload: {
          competition_id: competitionId,
          name: `R${i}`,
          club: null,
          class_id: classId,
          card_number: 200000 + i,
          consent: true,
        },
      });
    }

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/mip?lastid=2',
      headers: { lastid: '99' },
    });
    assert.equal(res.statusCode, 200);
    const entryMatches = (res.payload.match(/<entry\b/g) ?? []).length;
    // lastid=2 wins → entries for local_seq 3, 4, 5 = 3 entries.
    assert.equal(entryMatches, 3);
  });

  test('test 8: garbage lastid → 400 structured error (stricter than input.php)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=abc' });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { errors?: unknown[]; error?: string };
    // Either Zod-style or { error: ... } — both signal a structured 400.
    assert.ok(body.errors !== undefined || body.error !== undefined);
  });

  // --------------------------------------------------------------------------
  // Task 3 — card-replace re-emit round-trip (D-MIP-3)
  // --------------------------------------------------------------------------

  test('test 9 (Task 3, D-MIP-3): card-replace re-emits <entry> with SAME extId, NEW card', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx);
    const initial = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Replace, Test',
        club: null,
        class_id: classId,
        card_number: 11111,
        consent: true,
      },
    });
    assert.equal(initial.statusCode, 201);
    const competitorId = (initial.json() as { id: string }).id;

    // First poll picks up the original bind (local_seq 1) with card 11111.
    const firstPoll = await ctx.app.inject({ method: 'GET', url: '/mip?lastid=0' });
    assert.equal(firstPoll.statusCode, 200);
    const firstLastIdMatch = firstPoll.payload.match(/lastid="(\d+)"/);
    assert.ok(firstLastIdMatch && firstLastIdMatch[1]);
    const firstLastId = Number.parseInt(firstLastIdMatch[1] as string, 10);
    assert.match(firstPoll.payload, /<card>11111<\/card>/);
    assert.match(firstPoll.payload, new RegExp(`extId="${competitorId}"`));

    // Card-replace via the same POST /api/competitors handler. This is
    // Phase 1's existing path (routes/competitors.ts:157-297): it emits a
    // fresh card_bound event with the SAME competitor UUID and the NEW
    // card_number. D-MIP-3 leans on this — no new endpoint needed.
    const replace = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        card_number: 22222,
        replace_card_for_competitor_id: competitorId,
      },
    });
    assert.equal(replace.statusCode, 200);

    // Second poll picks up ONLY the replace event (local_seq > firstLastId)
    // and re-emits the entry with the SAME extId but the NEW card.
    const secondPoll = await ctx.app.inject({
      method: 'GET',
      url: `/mip?lastid=${firstLastId}`,
    });
    assert.equal(secondPoll.statusCode, 200);
    const body = secondPoll.payload;
    await expectXsdValid(body);

    // Exactly one <entry> in the delta.
    const entryMatches = body.match(/<entry\b/g) ?? [];
    assert.equal(entryMatches.length, 1);
    // Same extId — MeOS UPDATEs rather than INSERTs.
    assert.match(body, new RegExp(`extId="${competitorId}"`));
    // NEW card_number wins.
    assert.match(body, /<card>22222<\/card>/);
    // Old card no longer present in this delta.
    assert.equal(/<card>11111<\/card>/.test(body), false);
  });
});

// Use the imported configTable so it is not flagged as unused. Reserved
// for future tests that need to seed config directly.
void configTable;
