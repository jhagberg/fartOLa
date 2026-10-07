// Authored for fartola. Not ported from upstream.
//
// node:test coverage for POST /mop (Plan 02-04). Validates:
//
//   - Test 0a/0b/0c: bundled mop-*.xml fixtures are XSD-valid against mop.xsd.
//   - Test 1 (MOPComplete writes shadow tables): POST /mop with mop-complete-small.xml
//     returns 200 + MOPStatus OK; meos_competitors id=5490 exists with name 'Hagberg, Jonas'
//     card 12345; meos_classes id=1 'Vit'; meos_clubs id=637 'Stora Tuna OK'.
//   - Test 2 (MOPComplete TRUNCATE+INSERT): seed meos_competitors id=9999;
//     POST MOPComplete; id=9999 is GONE and id=5490 exists.
//   - Test 3 (transaction rollback on parse error): seed id=9999; POST malformed body;
//     MOPStatus ERROR; id=9999 still present (DELETE rolled back).
//   - Test 4 (MOPDiff UPSERT): seed id=5490 card=12345; POST mop-diff-upsert.xml;
//     id=5490 now has card=99999.
//   - Test 5 (MOPDiff DELETE): seed id=5490 + org id=637; POST mop-diff-delete.xml;
//     both rows DELETED.
//   - Test 6 (auto-merge happy path): active competition with class 'Vit' set;
//     POST mop-complete-small.xml; competitors gains a row with source='meos',
//     consent_status='pending_first_read', card_number=12345.
//   - Test 7 (auto-merge class-match guard): seed active comp + class 'Gul';
//     POST mop-complete-small.xml (cls name='Vit'); competitors unchanged.
//   - Test 8 (auto-merge skips when card already present): seed active comp + class
//     'Vit' + competitor with card 12345; POST mop-complete-small.xml; competitors
//     count remains 1.
//   - Test 9 (WS broadcast after commit): broadcastSink captures the meos_merge
//     envelope; verify channel=readoutChannel(active) + payload.count==1 AND that
//     the underlying competitors INSERT is already visible (broadcast AFTER commit).
//   - Test 10 (Pitfall 7 empty body): POST empty body → 200 MOPStatus ERROR.
//   - Test 11 (Pitfall 7 gzip 'P' byte): first byte 'P' (0x50) → 200 MOPStatus NOZIP.
//   - Test 12 (T-FILE-IMPORT DOCTYPE): POST body containing <!DOCTYPE → 200 ERROR;
//     meos_* tables UNCHANGED.
//   - Test 13: no password set, localhost: POST with no pwd + with
//     pwd=anything both succeed (D-MOP-4 revised 2026-10-05 — the password
//     and LAN cases are in access.test.ts).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-04-PLAN.md task 2
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-MOP-1..4
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 4: MOP POST /mop"
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §4 + S-4

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { validateXML } from 'xmllint-wasm';
import { eq, sql } from 'drizzle-orm';

import { buildServer } from '../../server.ts';
import type { BroadcastSink } from '../../server.ts';
import { openDatabase, type DbHandle } from '../../db/index.ts';
import { ensureNodeId } from '../../db/node-id.ts';
import { meosCompetitors, meosClasses, meosClubs, competitors } from '../../db/schema.ts';
import { readoutChannel } from '@fartola/shared-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOP_XSD = readFileSync(path.join(__dirname, 'mop.xsd'), 'utf8');
const FIX_DIR = path.join(__dirname, '__fixtures__');

const COMPLETE_XML = readFileSync(path.join(FIX_DIR, 'mop-complete-small.xml'), 'utf8');
const DIFF_UPSERT_XML = readFileSync(path.join(FIX_DIR, 'mop-diff-upsert.xml'), 'utf8');
const DIFF_DELETE_XML = readFileSync(path.join(FIX_DIR, 'mop-diff-delete.xml'), 'utf8');

/** Helper — validate one inline XML string against the bundled mop.xsd. */
async function expectXsdValid(xml: string, fileName = 'mop.xml'): Promise<void> {
  const result = await validateXML({
    xml: [{ fileName, contents: xml }],
    schema: [{ fileName: 'mop.xsd', contents: MOP_XSD }],
  });
  if (!result.valid) {
    const errs = result.errors.map((e) => e.message ?? e.rawMessage).join('\n');
    assert.fail(`XSD validation failed:\n${errs}\nXML:\n${xml}`);
  }
}

interface CapturedEnvelope {
  channel: string;
  envelope: { type: string; payload: unknown; seq?: number };
}

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  captured: CapturedEnvelope[];
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const captured: CapturedEnvelope[] = [];
  const sink: BroadcastSink = {
    record: (channel, envelope) => {
      captured.push({ channel, envelope });
    },
  };
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    broadcastSink: sink,
  });
  return { app, handle, captured };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  try {
    ctx.handle.close();
  } catch {
    /* already closed */
  }
}

/** Seed competition + class + set as active_competition_id. */
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

async function postMop(
  ctx: Ctx,
  body: string,
  contentType = 'text/xml'
): Promise<{ status: number; payload: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/mop',
    headers: { 'content-type': contentType },
    payload: body,
  });
  return { status: res.statusCode, payload: res.payload };
}

// ============================================================================
// Fixture XSD validation
// ============================================================================

describe('MOP fixtures vs bundled mop.xsd', () => {
  test('test 0a: mop-complete-small.xml is XSD-valid', async () => {
    await expectXsdValid(COMPLETE_XML, 'mop-complete-small.xml');
  });
  test('test 0b: mop-diff-upsert.xml is XSD-valid', async () => {
    await expectXsdValid(DIFF_UPSERT_XML, 'mop-diff-upsert.xml');
  });
  test('test 0c: mop-diff-delete.xml is XSD-valid', async () => {
    await expectXsdValid(DIFF_DELETE_XML, 'mop-diff-delete.xml');
  });
});

// ============================================================================
// POST /mop
// ============================================================================

describe('POST /mop — integrations/meos/mop', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  test('test 1: MOPComplete writes shadow tables; returns MOPStatus OK', async () => {
    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);
    const ct = res.payload;
    assert.match(ct, /<\?xml version="1\.0" encoding="UTF-8"\?>/);

    const cmpRows = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(cmpRows.length, 1);
    assert.equal(cmpRows[0]?.id, 5490);
    assert.equal(cmpRows[0]?.name, 'Hagberg, Jonas');
    assert.equal(cmpRows[0]?.cardNumber, 12345);

    const clsRows = ctx.handle.db.select().from(meosClasses).all();
    assert.equal(clsRows.length, 1);
    assert.equal(clsRows[0]?.id, 1);
    assert.equal(clsRows[0]?.name, 'Vit');

    const orgRows = ctx.handle.db.select().from(meosClubs).all();
    assert.equal(orgRows.length, 1);
    assert.equal(orgRows[0]?.id, 637);
    assert.equal(orgRows[0]?.name, 'Stora Tuna OK');
  });

  test('test 2: MOPComplete TRUNCATE+INSERT drops prior shadow rows', async () => {
    // Seed an existing row that the TRUNCATE should clear.
    ctx.handle.db
      .insert(meosCompetitors)
      .values({
        id: 9999,
        name: 'Stale, Row',
        statusCode: 0,
        lastMopUpdateMs: 1,
      })
      .run();
    const before = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(before.length, 1);

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    const after = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(after.length, 1);
    assert.equal(after[0]?.id, 5490);
  });

  test('test 3: malformed XML rolls back the DELETE — prior snapshot preserved', async () => {
    ctx.handle.db
      .insert(meosCompetitors)
      .values({
        id: 9999,
        name: 'Survivor',
        statusCode: 0,
        lastMopUpdateMs: 1,
      })
      .run();

    // Looks XML-ish but is truncated mid-tag — will fail XMLParser AFTER the
    // first byte check passes (no 'P' magic, no DOCTYPE).
    const malformed = '<MOPComplete xmlns="http://www.melin.nu/mop"><cmp id="1"><base';
    const res = await postMop(ctx, malformed);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="ERROR"\/>/);

    // The DELETE FROM meos_competitors was rolled back because the
    // surrounding transaction failed.
    const rows = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 9999);
  });

  test('test 4: MOPDiff UPSERT updates existing row by id', async () => {
    ctx.handle.db
      .insert(meosCompetitors)
      .values({
        id: 5490,
        name: 'Hagberg, Jonas',
        cardNumber: 12345,
        classId: 1,
        statusCode: 0,
        lastMopUpdateMs: 1,
      })
      .run();

    const res = await postMop(ctx, DIFF_UPSERT_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    const rows = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 5490);
    assert.equal(rows[0]?.cardNumber, 99999);
  });

  test('test 5: MOPDiff DELETE removes rows whose attribute is delete=true', async () => {
    ctx.handle.db
      .insert(meosCompetitors)
      .values({
        id: 5490,
        name: 'Hagberg, Jonas',
        statusCode: 0,
        lastMopUpdateMs: 1,
      })
      .run();
    ctx.handle.db
      .insert(meosClubs)
      .values({ id: 637, name: 'Stora Tuna OK', lastMopUpdateMs: 1 })
      .run();

    const res = await postMop(ctx, DIFF_DELETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    assert.equal(ctx.handle.db.select().from(meosCompetitors).all().length, 0);
    assert.equal(ctx.handle.db.select().from(meosClubs).all().length, 0);
  });

  test('test 6: auto-merge inserts MeOS-only competitor with source=meos', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx, { className: 'Vit' });

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    const compRows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, competitionId))
      .all();
    assert.equal(compRows.length, 1);
    const c = compRows[0];
    assert.ok(c);
    assert.equal(c.source, 'meos');
    assert.equal(c.consentStatus, 'pending_first_read');
    assert.equal(c.cardNumber, 12345);
    assert.equal(c.classId, classId);
    assert.equal(c.name, 'Hagberg, Jonas');
    assert.equal(c.club, 'Stora Tuna OK');
  });

  test('test 7: auto-merge class-match guard — UNKNOWN class skips the row', async () => {
    const { competitionId } = await seedActiveCompetition(ctx, { className: 'Gul' });

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    const compRows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, competitionId))
      .all();
    assert.equal(compRows.length, 0);
  });

  test('test 8: auto-merge skips when card_number already present', async () => {
    const { competitionId, classId } = await seedActiveCompetition(ctx, { className: 'Vit' });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: {
        competition_id: competitionId,
        name: 'Walkup, Wanda',
        club: 'STK',
        class_id: classId,
        card_number: 12345,
        consent: true,
      },
    });
    assert.equal(createRes.statusCode, 201);

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="OK"\/>/);

    const compRows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, competitionId))
      .all();
    assert.equal(compRows.length, 1);
    assert.equal(compRows[0]?.source, 'walkup');
  });

  test('test 9: meos_merge envelope broadcast AFTER commit', async () => {
    const { competitionId } = await seedActiveCompetition(ctx, { className: 'Vit' });

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);

    // Exactly one meos_merge envelope captured by the broadcastSink.
    const merges = ctx.captured.filter((c) => c.envelope.type === 'meos_merge');
    assert.equal(merges.length, 1);
    const merge = merges[0];
    assert.ok(merge);
    assert.equal(merge.channel, readoutChannel(competitionId));
    const payload = merge.envelope.payload as { count?: number };
    assert.equal(payload.count, 1);

    // Broadcast-after-commit: by the time the envelope landed, the
    // competitors INSERT was already visible (sanity check — SELECT after
    // the POST returns the inserted row).
    const compRows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, competitionId))
      .all();
    assert.equal(compRows.length, 1);
  });

  test('test 9b: NO meos_merge envelope when nothing was merged', async () => {
    // Inactive competition → mergedCount === 0 path → no broadcast.
    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);
    const merges = ctx.captured.filter((c) => c.envelope.type === 'meos_merge');
    assert.equal(merges.length, 0);
  });

  test('test 9c (Gemini G-003): auto-merged competitor IDs are RFC 4122 UUIDs (36-char hyphenated)', async () => {
    // Gemini review G-003: the previous SQL `lower(hex(randomblob(16)))`
    // produced 32-char hex strings with no hyphens, inconsistent with the
    // crypto.randomUUID() format used elsewhere. After the refactor, every
    // auto-merged competitor MUST carry a canonical UUID v4 ID so frontend
    // routes and IOF XML consumers see the same shape they get from walkup
    // POSTs (which always use crypto.randomUUID()).
    const { competitionId } = await seedActiveCompetition(ctx, { className: 'Vit' });

    const res = await postMop(ctx, COMPLETE_XML);
    assert.equal(res.status, 200);

    const compRows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, competitionId))
      .all();
    assert.equal(compRows.length, 1);
    const merged = compRows[0];
    assert.ok(merged);
    assert.equal(merged.source, 'meos');
    assert.match(
      merged.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      'auto-merged competitor id must be a canonical RFC 4122 UUID v4 (36 chars, hyphenated)'
    );
  });

  test('test 10: empty body → MOPStatus ERROR (Pitfall 7)', async () => {
    const res = await postMop(ctx, '');
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="ERROR"\/>/);
  });

  test('test 11: gzip-magic body (first byte P) → MOPStatus NOZIP (Pitfall 7)', async () => {
    // 'P' followed by 'K' is the ZIP local-file-header magic.
    const body = 'PKfake-gzip-body-bytes';
    const res = await postMop(ctx, body);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="NOZIP"\/>/);
  });

  test('test 12: DOCTYPE pre-flight (T-FILE-IMPORT) → MOPStatus ERROR; tables UNCHANGED', async () => {
    // Seed a sentinel row that proves the DELETE never ran.
    ctx.handle.db
      .insert(meosCompetitors)
      .values({
        id: 7777,
        name: 'Untouched',
        statusCode: 0,
        lastMopUpdateMs: 1,
      })
      .run();

    const body =
      '<!DOCTYPE foo>\n<MOPComplete xmlns="http://www.melin.nu/mop"><competition>x</competition></MOPComplete>';
    const res = await postMop(ctx, body);
    assert.equal(res.status, 200);
    assert.match(res.payload, /<MOPStatus status="ERROR"\/>/);

    const rows = ctx.handle.db.select().from(meosCompetitors).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 7777);
  });

  test('test 14 (F-002 regression): auto-merge does NOT re-merge stale shadow rows after active-competition switch', async () => {
    // F-002 BLOCKER scenario:
    //   1. Operator runs morning HD-träning (comp A). MeOS POSTs MOPComplete
    //      with one cmp → shadow rows land + auto-merge inserts into A.
    //   2. Operator switches active comp to 4-klubbs (comp B) for afternoon.
    //      B has class 'Vit' (same name as the MeOS class id=1 mapped).
    //   3. MeOS POSTs an empty-ish MOPDiff (or even any non-Complete POST).
    //      The OLD shadow row from step 1 must NOT be re-merged into B.
    const { competitionId: compA } = await seedActiveCompetition(ctx, { className: 'Vit' });

    // Step 1: POST MOPComplete → merges into comp A.
    const r1 = await postMop(ctx, COMPLETE_XML);
    assert.equal(r1.status, 200);
    const compACompetitors = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compA))
      .all();
    assert.equal(compACompetitors.length, 1, 'morning auto-merge should produce 1 row');

    // Step 2: create comp B + switch active. (Class name "Vit" same as A
    // and matches the MeOS class id=1 → maximum risk of cross-bleed.)
    const compBRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: '4-klubbs afternoon', date: '2026-05-20' },
    });
    assert.equal(compBRes.statusCode, 201);
    const compB = (compBRes.json() as { id: string }).id;
    const classBRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compB}/classes`,
      payload: { name: 'Vit' },
    });
    assert.equal(classBRes.statusCode, 201);
    const setRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions/active-competition',
      payload: { competition_id: compB },
    });
    assert.equal(setRes.statusCode, 200);

    // Step 3: MeOS sends a MOPDiff that DOES NOT mention card 12345
    // (touches an unrelated row only). The stale shadow row for card 12345
    // must NOT be re-merged into comp B by virtue of being in
    // meos_competitors. F-002 filter `last_mop_update_ms = nowMs` is the
    // guard.
    const unrelatedDiff =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<MOPDiff xmlns="http://www.melin.nu/mop">' +
      '<cmp id="9999" card="88888"><base cls="1">Other, Person</base></cmp>' +
      '</MOPDiff>';
    const r2 = await postMop(ctx, unrelatedDiff);
    assert.equal(r2.status, 200);

    const compBCompetitors = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compB))
      .all();
    // The new row (card 88888) should land in B because it WAS just
    // written. The stale row (card 12345 from morning) must NOT bleed in.
    const compBCards = compBCompetitors.map((c) => c.cardNumber).sort();
    assert.deepEqual(compBCards, [88888], 'only just-written rows merge into new active comp');
    assert.equal(
      compBCompetitors.length,
      1,
      'F-002 bug would have produced 2 rows here (stale + new)'
    );
  });

  test('test 13: no password set, localhost — works with no pwd AND with pwd=anything', async () => {
    const r1 = await postMop(ctx, COMPLETE_XML);
    assert.equal(r1.status, 200);

    // Reset shadow tables for a clean second POST.
    ctx.handle.db.run(sql`DELETE FROM meos_competitors`);
    ctx.handle.db.run(sql`DELETE FROM meos_classes`);
    ctx.handle.db.run(sql`DELETE FROM meos_clubs`);

    const r2 = await ctx.app.inject({
      method: 'POST',
      url: '/mop?pwd=anything',
      headers: { 'content-type': 'application/xml', pwd: 'also-anything' },
      payload: COMPLETE_XML,
    });
    assert.equal(r2.statusCode, 200);
    assert.match(r2.payload, /<MOPStatus status="OK"\/>/);
  });
});
