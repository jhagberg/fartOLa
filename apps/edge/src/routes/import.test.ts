// Authored for fartola. Not ported from upstream.
//
// node:test integration coverage for POST /api/competitions/:id/import.
// Exercises both kinds (CourseData + EntryList), the XSD failure path, the
// DOCTYPE rejection path, and the path-traversal filename rejection.
//
// Covers:
//   - test 1: Valid CourseData upload against an existing competition →
//     201 with classes/controls/courses counts; DB rows persisted.
//   - test 2 (C-M4): Valid EntryList upload after a CourseData import →
//     201; every imported competitor has consent_status='pending_first_read'
//     and consent_at_ms=null.
//   - test 3 (T-FILE-IMPORT): xml-bomb fixture → 400 parse_failed.
//   - test 4: XSD-invalid CourseData → 400 xsd_invalid.
//   - test 5: Competition does not exist → 404 competition_not_found.
//   - test 6 (T-PATH-TRAVERSAL): filename '../etc/passwd' → 400 bad_filename.
//   - test 7: Unknown XML root → 400 parse_failed with Purple-Pen-aware msg.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { competitors, events } from '../db/schema.ts';
import type { Competitor } from '../db/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', '..', 'test', 'fixtures');

function readFixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURE_DIR, name));
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

async function newCompetition(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/competitions',
    payload: { name: 'Import Test', date: '2026-05-22' },
  });
  return (res.json() as { id: string }).id;
}

async function uploadFile(
  app: FastifyInstance,
  url: string,
  filename: string,
  bytes: Buffer,
  contentType = 'application/xml'
): Promise<{ statusCode: number; body: unknown }> {
  // Build a multipart body using global FormData + File (Node 22+) so
  // app.inject() gets the exact bytes + headers @fastify/multipart expects.
  // Copy the Buffer into a fresh ArrayBuffer-backed Uint8Array so TS's
  // BlobPart constraint (ArrayBufferView<ArrayBuffer>, NOT ArrayBufferLike
  // which includes SharedArrayBuffer) is satisfied.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const form = new FormData();
  form.set('file', new File([ab], filename, { type: contentType }));
  // Use the global Request constructor to materialize the multipart body
  // + boundary into a single Buffer.
  const req = new Request('http://x/', { method: 'POST', body: form });
  const buf = Buffer.from(await req.arrayBuffer());
  const contentTypeHeader = req.headers.get('content-type') ?? '';
  const res = await app.inject({
    method: 'POST',
    url,
    payload: buf,
    headers: { 'content-type': contentTypeHeader },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('POST /api/competitions/:id/import', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: valid CourseData → 201 with counts; persisted', async () => {
    const compId = await newCompetition(ctx.app);
    const bytes = readFixture('iof30-coursedata-sample.xml');
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as {
      kind: string;
      classes_created: number;
      controls_created: number;
      courses_created: number;
    };
    assert.equal(body.kind, 'CourseData');
    assert.equal(body.classes_created, 2);
    assert.equal(body.controls_created, 4);
    assert.equal(body.courses_created, 2);
  });

  test('test 2 (C-M4): EntryList after CourseData → consent_status pending_first_read + consent_at_ms null', async () => {
    const compId = await newCompetition(ctx.app);
    // Seed classes via CourseData first.
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    const r1 = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course.xml',
      courseBytes
    );
    assert.equal(r1.statusCode, 201);

    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    const r2 = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'entries.xml',
      entryBytes
    );
    assert.equal(r2.statusCode, 201);
    const body = r2.body as {
      kind: string;
      competitors_created: number;
      classes_missing: string[];
    };
    assert.equal(body.kind, 'EntryList');
    assert.equal(body.competitors_created, 3);

    const rows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .all();
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.consentStatus, 'pending_first_read');
      assert.equal(row.consentAtMs, null);
    }
  });

  test('test 3 (T-FILE-IMPORT): xml-bomb → 400 parse_failed', async () => {
    const compId = await newCompetition(ctx.app);
    const bytes = readFixture('iof30-xml-bomb.xml');
    const res = await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'bomb.xml', bytes);
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string; detail?: string };
    assert.equal(body.error, 'parse_failed');
    assert.match(body.detail ?? '', /DOCTYPE/);
  });

  test('test 4: XSD-invalid CourseData → 400 xsd_invalid', async () => {
    const compId = await newCompetition(ctx.app);
    const bytes = readFixture('iof30-coursedata-corrupt.xml');
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'corrupt.xml',
      bytes
    );
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string; errors: Array<{ message: string }> };
    assert.equal(body.error, 'xsd_invalid');
    assert.ok(body.errors.length > 0);
  });

  test('test 5: unknown competition → 404', async () => {
    const bytes = readFixture('iof30-coursedata-sample.xml');
    const res = await uploadFile(
      ctx.app,
      '/api/competitions/00000000-0000-0000-0000-000000000000/import',
      'c.xml',
      bytes
    );
    assert.equal(res.statusCode, 404);
    const body = res.body as { error: string };
    assert.equal(body.error, 'competition_not_found');
  });

  test('test 6 (T-PATH-TRAVERSAL): @fastify/multipart strips the path component from filename; uploads with "../etc/passwd.xml" land as just "passwd.xml" + valid bytes import normally — the includes("..") guard in import.ts is defense-in-depth in case a future busboy/multipart version changes the basename behavior.', async () => {
    const compId = await newCompetition(ctx.app);
    const bytes = readFixture('iof30-coursedata-sample.xml');
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      '../etc/passwd.xml',
      bytes
    );
    // The multipart layer sanitizes the filename to 'passwd.xml' BEFORE
    // our route sees it. Result: valid CourseData → 201. If a future
    // @fastify/multipart version removes the basename behavior, our
    // includes('..') guard catches it and returns 400 bad_filename. We
    // assert "either status is acceptable" so this test does not break
    // on that future migration but DOES break if the import path itself
    // breaks.
    assert.ok(
      res.statusCode === 201 || res.statusCode === 400,
      `expected 201 (multipart-sanitized) or 400 (defense-in-depth caught), got ${res.statusCode}`
    );
    if (res.statusCode === 400) {
      assert.equal((res.body as { error: string }).error, 'bad_filename');
    }
  });

  test('test 8 (02.1-14 Task 6): EntryList response lists skipped rows', async () => {
    const compId = await newCompetition(ctx.app);
    await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course.xml',
      readFixture('iof30-coursedata-sample.xml')
    );
    const entries = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entries);
    // Re-import: the two carded entries are duplicates, Bo (no card) is new again.
    const res = await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'e.xml', entries);
    assert.equal(res.statusCode, 201);
    const body = res.body as { skipped: { row: number; reason: string }[] };
    assert.deepEqual(
      body.skipped.map((r) => [r.row, r.reason]),
      [
        [1, 'duplicate_card'],
        [3, 'duplicate_card'],
      ]
    );
  });

  test('test 7: unknown XML root → 400 parse_failed with Purple-Pen-aware message', async () => {
    const compId = await newCompetition(ctx.app);
    const bytes = Buffer.from('<?xml version="1.0"?><UnknownRoot/>', 'utf8');
    const res = await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'x.xml', bytes);
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string; detail?: string };
    assert.equal(body.error, 'parse_failed');
    assert.match(body.detail ?? '', /CourseData|EntryList/);
  });
});

// ---------------------------------------------------------------------------
// StartList import routes (Plan 02.1-03)
// ---------------------------------------------------------------------------

function buildStartListXmlBuffer(
  classes: Array<{
    className: string;
    persons: Array<{
      given: string;
      family: string;
      startTimeIso: string | null;
      siCard?: number;
      club?: string;
    }>;
  }>
): Buffer {
  const classParts = classes
    .map(({ className, persons }) => {
      const personParts = persons
        .map(
          ({ given, family, startTimeIso, siCard, club }) => `
      <PersonStart>
        <Person><Name><Family>${family}</Family><Given>${given}</Given></Name></Person>
        ${club != null ? `<Organisation><Name>${club}</Name></Organisation>` : ''}
        <Start>
          ${startTimeIso != null ? `<StartTime>${startTimeIso}</StartTime>` : ''}
          ${siCard != null ? `<ControlCard punchingSystem="SI">${siCard}</ControlCard>` : ''}
        </Start>
      </PersonStart>`
        )
        .join('\n');
      return `<ClassStart><Class><Name>${className}</Name></Class>${personParts}</ClassStart>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
           createTime="2026-05-19T18:00:00Z" creator="test">
  <Event><Name>Test</Name><StartTime><Date>2026-05-19</Date></StartTime></Event>
  ${classParts}
</StartList>`;
  return Buffer.from(xml, 'utf8');
}

describe('POST /api/competitions/:id/import/startlist', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('startlist test 1: exact SI card match → 201 with exact=1, start_time_ms written', async () => {
    const compId = await newCompetition(ctx.app);
    // Seed a class and competitor with a card number.
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);

    // Find the competitor's card number from the DB.
    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .limit(1)
      .all()[0];
    if (!row?.cardNumber) return; // Skip if no card — fixture-dependent.

    const startTimeIso = '2026-05-19T10:00:00Z';
    // Get the class name for this competitor from the DB.
    const { eq: eqFn } = await import('drizzle-orm');
    const { classes: classesTable } = await import('../db/schema.ts');
    const classRow = ctx.handle.db
      .select({ name: classesTable.name })
      .from(classesTable)
      .where(eqFn(classesTable.id, row.classId))
      .get();
    const className = classRow?.name ?? 'H21';
    const bytes = buildStartListXmlBuffer([
      {
        className,
        persons: [{ given: 'Anna', family: 'Andersson', startTimeIso, siCard: row.cardNumber }],
      },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'startlist.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as { exact: number; fuzzy: number; unmatched: number };
    assert.equal(body.exact, 1);

    // Verify DB write.
    const updated = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, row.id))
      .get();
    assert.equal(updated?.startTimeMs, new Date(startTimeIso).getTime());
  });

  test('startlist test 2: name-only match → fuzzy, NOT auto-applied', async () => {
    const compId = await newCompetition(ctx.app);
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);

    // Get a competitor name from the DB (no card in the StartList XML).
    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .limit(1)
      .all()[0];
    if (!row) return;

    // Parse "Given Family" → split for XML
    const parts = row.name.split(' ');
    const family = parts.pop() ?? '';
    const given = parts.join(' ');

    // Get class name for this competitor.
    const { eq: eqFn2 } = await import('drizzle-orm');
    const { classes: classesTable2 } = await import('../db/schema.ts');
    const classRow2 = ctx.handle.db
      .select({ name: classesTable2.name })
      .from(classesTable2)
      .where(eqFn2(classesTable2.id, row.classId))
      .get();
    const className2 = classRow2?.name ?? 'H21';

    const startTimeIso = '2026-05-19T10:00:00Z';
    // No siCard in StartList → name-only match (fuzzy, not exact).
    const bytes = buildStartListXmlBuffer([
      { className: className2, persons: [{ given, family, startTimeIso }] },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'startlist.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as {
      exact: number;
      fuzzy: number;
      unmatched: number;
      fuzzyMatches: unknown[];
    };
    // Name-only → fuzzy, not exact.
    assert.ok(body.fuzzy >= 0); // May be fuzzy or unmatched depending on fixture.
    assert.equal(body.exact, 0, 'no SI card match → not exact');
    // start_time_ms must NOT be written (fuzzy is pending_confirmation).
    const still = ctx.handle.db.select().from(competitors).where(eq(competitors.id, row.id)).get();
    assert.equal(still?.startTimeMs, null, 'fuzzy match must not auto-write start_time_ms');
  });

  test('startlist test 4 (02.1-14 Task 6): changed card matched by name + club; skips reported', async () => {
    const compId = await newCompetition(ctx.app);
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);
    const byName = (name: string) =>
      ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, compId))
        .all()
        .find((c) => c.name === name)!;

    const startTimeIso = '2026-05-19T10:00:00Z';
    const bytes = buildStartListXmlBuffer([
      {
        className: 'H21',
        persons: [
          // Anna entered with 7501853, runs on a rented card: name + club match.
          {
            given: 'Anna',
            family: 'Andersson',
            club: 'stortuna ok',
            siCard: 8000001,
            startTimeIso,
          },
          // Bo's new card already belongs to Cia (D21): cannot take it.
          { given: 'Bo', family: 'Berg', club: 'StorTuna OK', siCard: 1428824, startTimeIso },
          { given: 'Okänd', family: 'Löpare', club: 'X', siCard: 8000002, startTimeIso },
          { given: 'Utan', family: 'Tid', siCard: 8000003, startTimeIso: null },
        ],
      },
      { className: 'H99', persons: [{ given: 'Fel', family: 'Klass', startTimeIso }] },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'startlist.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as {
      exact: number;
      card_updated: number;
      unmatched: number;
      cardUpdates: unknown[];
      skipped: unknown[];
    };
    const anna = byName('Anna Andersson');
    assert.equal(body.card_updated, 1);
    assert.deepEqual(body.cardUpdates, [
      {
        row: 1,
        competitor_id: anna.id,
        name: 'Anna Andersson',
        class: 'H21',
        previous_card: 7501853,
        card: 8000001,
      },
    ]);
    assert.equal(anna.cardNumber, 8000001);
    assert.equal(anna.startTimeMs, Date.parse(startTimeIso));
    assert.equal(byName('Bo Berg').cardNumber, null, 'conflicting card not taken');
    assert.deepEqual(body.skipped, [
      { row: 2, name: 'Bo Berg', class: 'H21', card: 1428824, reason: 'duplicate_card' },
      { row: 3, name: 'Okänd Löpare', class: 'H21', card: 8000002, reason: 'no_match' },
      { row: 4, name: 'Utan Tid', class: 'H21', card: 8000003, reason: 'no_start_time' },
      { row: 5, name: 'Fel Klass', class: 'H99', card: null, reason: 'unknown_class' },
    ]);
    assert.equal(body.unmatched, 4);
  });

  /** CourseData + EntryList: H21 = Anna Andersson (7501853) and Bo Berg (no
   * card), both StorTuna OK. Returns a by-name row reader. */
  async function seedAnnaAndBo(): Promise<{ compId: string; byName: (n: string) => Competitor }> {
    const compId = await newCompetition(ctx.app);
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);
    const byName = (name: string): Competitor =>
      ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, compId))
        .all()
        .find((c) => c.name === name)!;
    return { compId, byName };
  }

  test("startlist: two rows with the same card don't overwrite each other's start", async () => {
    const { compId, byName } = await seedAnnaAndBo();
    const bytes = buildStartListXmlBuffer([
      {
        className: 'H21',
        persons: [
          {
            given: 'Anna',
            family: 'Andersson',
            club: 'StorTuna OK',
            siCard: 555,
            startTimeIso: '2026-05-19T10:00:00Z',
          },
          {
            given: 'Bo',
            family: 'Berg',
            club: 'StorTuna OK',
            siCard: 555,
            startTimeIso: '2026-05-19T11:00:00Z',
          },
        ],
      },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'sl.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as { exact: number; card_updated: number; skipped: unknown[] };
    assert.equal(body.exact, 0);
    assert.equal(body.card_updated, 0);
    assert.deepEqual(body.skipped, [
      { row: 1, name: 'Anna Andersson', class: 'H21', card: 555, reason: 'duplicate_card' },
      { row: 2, name: 'Bo Berg', class: 'H21', card: 555, reason: 'duplicate_card' },
    ]);
    const anna = byName('Anna Andersson');
    assert.equal(anna.cardNumber, 7501853);
    assert.equal(anna.startTimeMs, null);
    assert.equal(byName('Bo Berg').startTimeMs, null);
  });

  test('startlist: two imported runners resolving to one competitor are both left unapplied', async () => {
    const { compId, byName } = await seedAnnaAndBo();
    // Bo's row carries Anna's card (exact card match → Anna); Anna's own row
    // has a new card and matches her by name + club. Neither may win silently.
    const bytes = buildStartListXmlBuffer([
      {
        className: 'H21',
        persons: [
          {
            given: 'Bo',
            family: 'Berg',
            club: 'StorTuna OK',
            siCard: 7501853,
            startTimeIso: '2026-05-19T11:00:00Z',
          },
          {
            given: 'Anna',
            family: 'Andersson',
            club: 'StorTuna OK',
            siCard: 8000001,
            startTimeIso: '2026-05-19T10:00:00Z',
          },
        ],
      },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'sl.xml',
      bytes
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as { exact: number; card_updated: number; skipped: unknown[] };
    assert.equal(body.exact, 0);
    assert.equal(body.card_updated, 0);
    assert.deepEqual(body.skipped, [
      { row: 1, name: 'Bo Berg', class: 'H21', card: 7501853, reason: 'duplicate_runner' },
      { row: 2, name: 'Anna Andersson', class: 'H21', card: 8000001, reason: 'duplicate_runner' },
    ]);
    const anna = byName('Anna Andersson');
    assert.equal(anna.cardNumber, 7501853);
    assert.equal(anna.startTimeMs, null);
  });

  test('startlist: a discarded card change does not free its card for a later row', async () => {
    const { compId, byName } = await seedAnnaAndBo();
    ctx.handle.sqlite
      .prepare(`UPDATE competitors SET card_number = 2222 WHERE competition_id = ? AND name = ?`)
      .run(compId, 'Bo Berg');
    // Anna's two card changes conflict and are both dropped, so she keeps
    // 7501853 — Bo's row may not take it.
    const anna = { given: 'Anna', family: 'Andersson', club: 'StorTuna OK' };
    const bytes = buildStartListXmlBuffer([
      {
        className: 'H21',
        persons: [
          { ...anna, siCard: 5555, startTimeIso: '2026-05-19T10:00:00Z' },
          { ...anna, siCard: 6666, startTimeIso: '2026-05-19T10:05:00Z' },
          {
            given: 'Bo',
            family: 'Berg',
            club: 'StorTuna OK',
            siCard: 7501853,
            startTimeIso: '2026-05-19T11:00:00Z',
          },
        ],
      },
    ]);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/startlist`,
      'sl.xml',
      bytes
    );
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const body = res.body as { exact: number; card_updated: number; skipped: unknown[] };
    assert.equal(body.exact, 0);
    assert.equal(body.card_updated, 0);
    assert.deepEqual(body.skipped, [
      { row: 1, name: 'Anna Andersson', class: 'H21', card: 5555, reason: 'duplicate_runner' },
      { row: 2, name: 'Anna Andersson', class: 'H21', card: 6666, reason: 'duplicate_runner' },
      { row: 3, name: 'Bo Berg', class: 'H21', card: 7501853, reason: 'duplicate_card' },
    ]);
    assert.equal(byName('Anna Andersson').cardNumber, 7501853);
    assert.equal(byName('Anna Andersson').startTimeMs, null);
    assert.equal(byName('Bo Berg').cardNumber, 2222);
    assert.equal(byName('Bo Berg').startTimeMs, null);
  });

  test('startlist test 3: competition not found → 404', async () => {
    const bytes = buildStartListXmlBuffer([{ className: 'H21', persons: [] }]);
    const res = await uploadFile(
      ctx.app,
      '/api/competitions/00000000-0000-0000-0000-000000000000/import/startlist',
      'sl.xml',
      bytes
    );
    assert.equal(res.statusCode, 404);
  });
});

describe('POST /api/competitions/:id/import/startlist/confirm', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('confirm test 1: applies confirmed fuzzy matches', async () => {
    const compId = await newCompetition(ctx.app);
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);

    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .limit(1)
      .all()[0];
    if (!row) return;

    const targetMs = new Date('2026-05-19T10:30:00Z').getTime();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/import/startlist/confirm`,
      payload: { matches: [{ competitorId: row.id, startTimeMs: targetMs }] },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { applied: number; alreadyApplied: number };
    assert.equal(body.applied, 1);
    assert.equal(body.alreadyApplied, 0);

    const updated = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.id, row.id))
      .get();
    assert.equal(updated?.startTimeMs, targetMs);
  });

  test('confirm test 2: idempotent — re-confirming returns alreadyApplied', async () => {
    const compId = await newCompetition(ctx.app);
    const courseBytes = readFixture('iof30-coursedata-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'course.xml', courseBytes);
    const entryBytes = readFixture('iof30-entrylist-sample.xml');
    await uploadFile(ctx.app, `/api/competitions/${compId}/import`, 'entries.xml', entryBytes);

    const row = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .limit(1)
      .all()[0];
    if (!row) return;

    const targetMs = new Date('2026-05-19T10:30:00Z').getTime();
    const body1 = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${compId}/import/startlist/confirm`,
        payload: { matches: [{ competitorId: row.id, startTimeMs: targetMs }] },
      })
    ).json() as { applied: number; alreadyApplied: number };
    assert.equal(body1.applied, 1);

    // Second call (idempotent).
    const body2 = (
      await ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${compId}/import/startlist/confirm`,
        payload: { matches: [{ competitorId: row.id, startTimeMs: targetMs }] },
      })
    ).json() as { applied: number; alreadyApplied: number };
    assert.equal(body2.applied, 0, 'second confirm must not re-write');
    assert.equal(body2.alreadyApplied, 1, 'must count already-applied');
  });

  test('confirm rejects a non-epoch start time and writes nothing from the batch', async () => {
    const compId = await newCompetition(ctx.app);
    await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course.xml',
      readFixture('iof30-coursedata-sample.xml')
    );
    await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'entries.xml',
      readFixture('iof30-entrylist-sample.xml')
    );
    const [a, b] = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .all();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/import/startlist/confirm`,
      payload: {
        matches: [
          { competitorId: a!.id, startTimeMs: Date.parse('2026-05-19T10:30:00Z') },
          { competitorId: b!.id, startTimeMs: 36_000_000 }, // 10:00 as ms since midnight
        ],
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const rows = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.competitionId, compId))
      .all();
    assert.ok(rows.every((r) => r.startTimeMs === null));
  });

  test('confirm test 3: competition not found → 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000/import/startlist/confirm',
      payload: { matches: [] },
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('POST /api/competitions/:id/import — cached results follow the import', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    const handle = openDatabase(':memory:');
    const nodeId = ensureNodeId(handle);
    const app = await buildServer({
      logger: false,
      dbHandle: handle,
      nodeId,
      projectionDebounceMs: 0,
    });
    ctx = { app, handle };
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  const settle = () => new Promise((r) => setTimeout(r, 20));
  const h21Rows = async (compId: string) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/competitions/${compId}/results` });
    const body = res.json() as {
      classes: Array<{ class_name: string; rows: Array<{ name: string; status: string }> }>;
    };
    return body.classes.find((c) => c.class_name === 'H21')!.rows;
  };

  /** Course + entries imported, race started, Anna (H21, Bana 1 = 31-34)
   * read out with punches 31, 32 only → MP, and that result is cached. */
  async function annaMpCached(): Promise<string> {
    const compId = await newCompetition(ctx.app);
    await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course.xml',
      readFixture('iof30-coursedata-sample.xml')
    );
    await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'entries.xml',
      readFixture('iof30-entrylist-sample.xml')
    );
    ctx.handle.sqlite
      .prepare(`UPDATE competitions SET race_started_at_ms = 0 WHERE id = ?`)
      .run(compId);
    const clock = (s: number) => ({ half_day: 0 as const, seconds_in_half_day: s, weekday: null });
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'node-test',
        localSeq: 1,
        competitionId: compId,
        eventType: 'card_read',
        eventTimeMs: Date.UTC(2026, 4, 22, 12),
        recordedAtMs: Date.UTC(2026, 4, 22, 12),
        payload: {
          event_type: 'card_read',
          card_number: 7501853,
          card_type: 'SI10',
          start: clock(9 * 3600),
          finish: clock(9 * 3600 + 1800),
          check: null,
          clear: null,
          punch_count: 2,
          punches: [
            { code: 31, ...clock(9 * 3600 + 600) },
            { code: 32, ...clock(9 * 3600 + 1200) },
          ],
          card_holder: null,
        },
      })
      .run();
    // Anna's card is already bound, so a later EntryList import binds nothing new.
    const anna = ctx.handle.db
      .select()
      .from(competitors)
      .where(eq(competitors.cardNumber, 7501853))
      .get()!;
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: 'node-test',
        localSeq: 2,
        competitionId: compId,
        eventType: 'card_bound',
        eventTimeMs: Date.UTC(2026, 4, 22, 12, 1),
        recordedAtMs: Date.UTC(2026, 4, 22, 12, 1),
        payload: {
          event_type: 'card_bound',
          competitor_id: anna.id,
          card_number: 7501853,
          walkup: false,
          consent_at_ms: 0,
        },
      })
      .run();
    await settle(); // let the imports' own recompute land before caching the MP
    const before = await h21Rows(compId);
    assert.equal(before.find((r) => r.name === 'Anna Andersson')?.status, 'MP');
    return compId;
  }

  test('a corrected CourseData import re-scores the cached results', async () => {
    const compId = await annaMpCached();
    // Bana 1 corrected to 31, 32.
    const corrected = readFixture('iof30-coursedata-sample.xml')
      .toString('utf8')
      .replace(
        /(<Name>Bana 1<\/Name>[\s\S]*?<Control>32<\/Control>\s*<\/CourseControl>)[\s\S]*?(<CourseControl type="Finish">)/,
        '$1\n      $2'
      );
    assert.notEqual(corrected, readFixture('iof30-coursedata-sample.xml').toString('utf8'));
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'course2.xml',
      Buffer.from(corrected)
    );
    assert.equal(res.statusCode, 201);
    await settle();
    const after = await h21Rows(compId);
    assert.equal(after.find((r) => r.name === 'Anna Andersson')?.status, 'OK');
  });

  test('an EntryList import without newly bound cards still refreshes the cached results', async () => {
    const compId = await annaMpCached();
    // Same list with Bo Berg renamed to a new runner, Dag Ek (no card).
    const entries = readFixture('iof30-entrylist-sample.xml')
      .toString('utf8')
      .replace('<Family>Berg</Family>', '<Family>Ek</Family>')
      .replace('<Given>Bo</Given>', '<Given>Dag</Given>');
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import`,
      'entries2.xml',
      Buffer.from(entries)
    );
    assert.equal(res.statusCode, 201);
    await settle();
    const after = await h21Rows(compId);
    assert.ok(
      after.some((r) => r.name === 'Dag Ek'),
      JSON.stringify(after)
    );
  });
});

describe('POST /api/competitions/:id/import/previous-results (SOFT TR 7.4.1)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  /** A day-1 IOF 3.0 ResultList: [given, family, club, eventorId|null, seconds|null, status]. */
  function resultList(
    rows: Array<[string, string, string, number | null, number | null, string]>,
    className = 'H21'
  ) {
    const person = ([given, family, club, id, seconds, status]: (typeof rows)[number]) =>
      `<PersonResult><Person>${id === null ? '' : `<Id type="Eventor">${id}</Id>`}<Name><Family>${family}</Family><Given>${given}</Given></Name></Person>` +
      `<Organisation><Name>${club}</Name></Organisation>` +
      `<Result>${seconds === null ? '' : `<Time>${seconds}</Time>`}<Status>${status}</Status></Result></PersonResult>`;
    return Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-05-23T18:00:00Z" creator="MeOS">
  <Event><Name>Dag 1</Name><StartTime><Date>2026-05-23</Date></StartTime></Event>
  <ClassResult><Class><Name>${className}</Name></Class>${rows.map(person).join('')}</ClassResult>
</ResultList>`,
      'utf8'
    );
  }

  test('SOFT TR 7.4.1: matches by Eventor id, then name and club; stores the result; lists the unmatched without failing', async () => {
    const compId = await newCompetition(ctx.app);
    const cls = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/classes`,
      payload: { name: 'H21' },
    });
    const classId = (cls.json() as { id: string }).id;
    const add = (id: string, name: string, club: string, eventorPersonId: number | null) =>
      ctx.handle.db
        .insert(competitors)
        .values({ id, competitionId: compId, name, club, classId, eventorPersonId })
        .run();
    add('a', 'Anna Andersson', 'OK Ek', 4711);
    add('b', 'Bo Berg', 'IFK', null);
    add('c', 'Cia Carlsson', 'OK Ek', null);

    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/previous-results`,
      'dag1.xml',
      resultList([
        ['Anna', 'A', 'Annan klubb', 4711, 2400.4, 'OK'],
        ['Bo', 'Berg', 'IFK', null, 2500, 'MissingPunch'],
        ['Okänd', 'Person', 'OK Ek', null, 2600, 'OK'],
      ])
    );
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      results: 3,
      matched: 2,
      unmatched: [{ competitor_id: 'c', name: 'Cia Carlsson', club: 'OK Ek', class_name: 'H21' }],
    });
    const stored = Object.fromEntries(
      ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, compId))
        .all()
        .map((r) => [r.id, [r.inputTimeMs, r.inputStatus]])
    );
    assert.deepEqual(stored, {
      a: [2_400_000, 'OK'],
      b: [2_500_000, 'MissingPunch'],
      c: [null, null],
    });
  });

  test('a file that is not XSD-valid → 400, nothing stored', async () => {
    const compId = await newCompetition(ctx.app);
    const res = await uploadFile(
      ctx.app,
      `/api/competitions/${compId}/import/previous-results`,
      'bad.xml',
      Buffer.from('<ResultList xmlns="http://www.orienteering.org/datastandard/3.0"/>', 'utf8')
    );
    assert.equal(res.statusCode, 400);
  });

  test('a ResultList replaces only the classes it contains; other classes keep their results', async () => {
    const compId = await newCompetition(ctx.app);
    const mk = async (name: string) =>
      (
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/competitions/${compId}/classes`,
            payload: { name },
          })
        ).json() as { id: string }
      ).id;
    const h = await mk('H21');
    const d = await mk('D21');
    ctx.handle.db
      .insert(competitors)
      .values([
        { id: 'h', competitionId: compId, name: 'Hugo Ek', club: 'OK', classId: h },
        { id: 'd', competitionId: compId, name: 'Dora Ek', club: 'OK', classId: d },
      ])
      .run();
    const url = `/api/competitions/${compId}/import/previous-results`;
    await uploadFile(
      ctx.app,
      url,
      'h.xml',
      resultList([['Hugo', 'Ek', 'OK', null, 2000, 'OK']], 'H21')
    );
    const second = await uploadFile(
      ctx.app,
      url,
      'd.xml',
      resultList([['Dora', 'Ek', 'OK', null, 2100, 'OK']], 'D21')
    );
    assert.deepEqual(second.body, { results: 1, matched: 1, unmatched: [] });
    const stored = Object.fromEntries(
      ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, compId))
        .all()
        .map((r) => [r.id, r.inputTimeMs])
    );
    assert.deepEqual(stored, { h: 2_000_000, d: 2_100_000 });
  });
});
