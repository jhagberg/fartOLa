// Authored for fartola. Not ported from upstream.
//
// node:test C-H3 regression coverage for POST /api/competitions/from-wizard.
// The atomic-rollback contract is the load-bearing reason this endpoint
// exists; tests 2 + 3 are the regression gates that prove the contract
// holds end-to-end (codex C-H3).
//
// Covers:
//   - test 1 (happy path): valid CourseData base64 → 201; competition +
//     classes + courses persisted.
//   - test 2 (C-H3 early-exit rollback): XSD-invalid CourseData → 400; the
//     competitions row count is unchanged (the XSD reject lands BEFORE
//     the transaction opens — the easy case).
//   - test 3 (C-H3 mid-transaction rollback — THE GATE): a CourseData
//     that parses + passes XSD but FAILS during ingestCourseData (course
//     references an undeclared control) → 422; competitions row count
//     unchanged. This proves the in-transaction rollback path, not just
//     the early-return path.
//   - test 4 (T-PATH-TRAVERSAL): xml_file.name with '..' → 400 bad_filename;
//     competitions count unchanged.
//   - test 5 (T-LARGE-BODY-DOS): oversized base64 (> 5 MB after decode) → 413.
//   - test 6: garbage base64 → 400 bad_base64; competitions count unchanged.
//   - test 7 (C-M4 + entrylist_without_courses): valid EntryList sample with
//     NO classes seeded yet → 422 entrylist_without_courses; competitions
//     count unchanged.
//   - test 8: malformed XML → 400 parse_failed; count unchanged.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H3

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
import { classes, competitions } from '../db/schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', '..', 'test', 'fixtures');

function readFixtureB64(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name)).toString('base64');
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

function countCompetitions(handle: DbHandle): number {
  return handle.db.select({ id: competitions.id }).from(competitions).all().length;
}

async function postFromWizard(
  app: FastifyInstance,
  payload: Record<string, unknown>
): Promise<{ statusCode: number; body: unknown }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/competitions/from-wizard',
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('POST /api/competitions/from-wizard (C-H3 atomic)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1 (happy path): valid CourseData → 201; competition + classes + courses persist', async () => {
    const content_base64 = readFixtureB64('iof30-coursedata-sample.xml');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'StorTuna Tisdag',
      date: '2026-05-22',
      xml_file: { name: 'course.xml', content_base64 },
    });
    assert.equal(res.statusCode, 201);
    const body = res.body as {
      competition_id: string;
      kind: string;
      classes_created: number;
      controls_created: number;
      courses_created: number;
    };
    assert.equal(body.kind, 'CourseData');
    assert.equal(body.classes_created, 2);
    assert.equal(body.controls_created, 4);
    assert.equal(body.courses_created, 2);
    assert.equal(countCompetitions(ctx.handle), before + 1);
  });

  test('ADR-0018: the level is stored before the import, so the classes get their start choice from it', async () => {
    const xml = readFileSync(
      path.join(FIXTURE_DIR, 'iof30-coursedata-sample.xml'),
      'utf8'
    ).replaceAll('D21', 'Öppen 3');
    const content_base64 = Buffer.from(xml).toString('base64');
    const methods = async (level?: string) => {
      const res = await postFromWizard(ctx.app, {
        name: 'Nivå',
        date: '2026-05-22',
        xml_file: { name: 'course.xml', content_base64 },
        ...(level ? { level } : {}),
      });
      assert.equal(res.statusCode, 201);
      const id = (res.body as { competition_id: string }).competition_id;
      return Object.fromEntries(
        ctx.handle.db
          .select()
          .from(classes)
          .where(eq(classes.competitionId, id))
          .all()
          .map((r) => [r.name, r.startMethod])
      );
    };
    assert.deepEqual(await methods('niva2'), { H21: 'start_time', 'Öppen 3': 'free_start' });
    assert.deepEqual(await methods(), { H21: 'free_start', 'Öppen 3': 'free_start' });
    const bad = await postFromWizard(ctx.app, {
      name: 'x',
      date: '2026-05-22',
      xml_file: { name: 'c.xml', content_base64 },
      level: 'niva9',
    });
    assert.equal(bad.statusCode, 400);
  });

  test('test 2 (C-H3 early-exit rollback): XSD-invalid CourseData → 400; competitions count unchanged', async () => {
    const content_base64 = readFixtureB64('iof30-coursedata-corrupt.xml');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'Should Not Persist',
      date: '2026-05-22',
      xml_file: { name: 'corrupt.xml', content_base64 },
    });
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string; errors: unknown[] };
    assert.equal(body.error, 'xsd_invalid');
    assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
    assert.equal(
      countCompetitions(ctx.handle),
      before,
      'competitions row count must be unchanged after xsd_invalid (C-H3 early-exit)'
    );
  });

  test('test 3 (C-H3 mid-transaction rollback — THE GATE): course references unknown control → 422; count unchanged', async () => {
    // Craft an XSD-valid CourseData where Bana 1 references control code
    // 99 but only 31 is declared at the top level. fast-xml-parser accepts
    // it; libxml2 accepts it (the schema permits arbitrary CourseControl
    // codes without cross-referencing the Control list); ingestCourseData
    // throws inside doIngest with "unknown control 99". Because the throw
    // happens INSIDE app.fartolaDb.sqlite.transaction, better-sqlite3 rolls
    // BOTH the competition INSERT and any partial ingest writes back.
    const adversarial =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">' +
      '<Event><Name>Mid-tx fail</Name></Event>' +
      '<RaceCourseData>' +
      '<Control><Id>31</Id></Control>' +
      '<Course>' +
      '<Name>Bana 1</Name>' +
      '<CourseControl><Control>31</Control></CourseControl>' +
      '<CourseControl><Control>99</Control></CourseControl>' +
      '</Course>' +
      '</RaceCourseData>' +
      '</CourseData>';
    const content_base64 = Buffer.from(adversarial, 'utf8').toString('base64');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'Must Roll Back',
      date: '2026-05-22',
      xml_file: { name: 'mid.xml', content_base64 },
    });
    assert.equal(res.statusCode, 422);
    const body = res.body as { error: string; detail?: string };
    assert.equal(body.error, 'ingest_failed');
    assert.match(body.detail ?? '', /unknown control 99/);
    assert.equal(
      countCompetitions(ctx.handle),
      before,
      'competitions row count must be unchanged after mid-tx throw (C-H3 regression gate)'
    );
  });

  test('test 4 (T-PATH-TRAVERSAL): xml_file.name with .. → 400 bad_filename; count unchanged', async () => {
    const content_base64 = readFixtureB64('iof30-coursedata-sample.xml');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'X',
      date: '2026-05-22',
      xml_file: { name: '../etc/passwd.xml', content_base64 },
    });
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string };
    assert.equal(body.error, 'bad_filename');
    assert.equal(countCompetitions(ctx.handle), before);
  });

  test('test 5 (T-LARGE-BODY-DOS): decoded > 5 MB → 413; count unchanged', async () => {
    // Build a base64 payload that decodes to ~5.5 MB. The encoded body
    // (5.5 MB * 4/3 + JSON envelope) is just under the route's 7.5 MB
    // bodyLimit so Fastify hands the request to our handler, and our
    // decoded-byteLength check then fires the explicit 'file_too_large'
    // response. Payloads beyond ~5.6 MB are caught earlier by Fastify's
    // bodyLimit (still a 413, just with the generic 'Payload Too Large'
    // message) — that path is the OUTER mitigation for T-LARGE-BODY-DOS.
    const big = Buffer.alloc(Math.ceil(5.5 * 1024 * 1024), 0x41);
    const content_base64 = big.toString('base64');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'X',
      date: '2026-05-22',
      xml_file: { name: 'big.xml', content_base64 },
    });
    assert.equal(res.statusCode, 413);
    const body = res.body as { error?: string; message?: string };
    // Either our explicit file_too_large (when the body fit through
    // bodyLimit and our decoded-size check fired) OR Fastify's default
    // body shape (when bodyLimit caught it first). Both are correct
    // T-LARGE-BODY-DOS mitigations.
    if (body.error) {
      assert.equal(body.error, 'file_too_large');
    } else {
      assert.match(body.message ?? '', /too large/i);
    }
    assert.equal(countCompetitions(ctx.handle), before);
  });

  test('test 6: empty/garbage base64 → 400 bad_base64; count unchanged', async () => {
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'X',
      date: '2026-05-22',
      xml_file: { name: 'x.xml', content_base64: '!@#$%^&*()' }, // all non-base64
    });
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string };
    assert.equal(body.error, 'bad_base64');
    assert.equal(countCompetitions(ctx.handle), before);
  });

  test('test 7 (C-M4 + entrylist_without_courses): EntryList against fresh competition → 422; count unchanged', async () => {
    const content_base64 = readFixtureB64('iof30-entrylist-sample.xml');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'EntryList First',
      date: '2026-05-22',
      xml_file: { name: 'entries.xml', content_base64 },
    });
    assert.equal(res.statusCode, 422);
    const body = res.body as { error: string; detail?: string };
    assert.equal(body.error, 'entrylist_without_courses');
    assert.match(body.detail ?? '', /upload CourseData first/);
    assert.equal(
      countCompetitions(ctx.handle),
      before,
      'EntryList-without-courses path must roll back the competition INSERT'
    );
  });

  test('test 8: malformed XML → 400 parse_failed; count unchanged', async () => {
    const content_base64 = Buffer.from('<not-xml@', 'utf8').toString('base64');
    const before = countCompetitions(ctx.handle);
    const res = await postFromWizard(ctx.app, {
      name: 'X',
      date: '2026-05-22',
      xml_file: { name: 'x.xml', content_base64 },
    });
    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string };
    assert.equal(body.error, 'parse_failed');
    assert.equal(countCompetitions(ctx.handle), before);
  });

  test('test 9: missing required fields → 400 with zod error path', async () => {
    const res = await postFromWizard(ctx.app, {
      // name omitted
      date: '2026-05-22',
      xml_file: { name: 'x.xml', content_base64: 'AAAA' },
    });
    assert.equal(res.statusCode, 400);
    const body = res.body as { errors: { path: string }[] };
    assert.ok(body.errors.some((e) => e.path === 'name'));
  });
});
