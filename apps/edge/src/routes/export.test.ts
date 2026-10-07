// Authored for fartola. Not ported from upstream.
//
// node:test coverage for GET /api/competitions/:id/export[/preview]
// (plan 16 task 2). Six tests:
//
//   1. Seeded competition (2 classes, 3 competitors with card_reads) →
//      preview returns valid=true with the expected summary counts.
//   2. format=iof30 returns 200 with application/xml and the body has
//      @status in {Complete, Delta, Snapshot} (W-4 route-layer gate).
//   3. Unsupported format → 400.
//   4. status=Provisional → summary.status='Provisional'; downloaded XML
//      carries @status='Snapshot'.
//   5. Empty competition (no events) with NO status query param →
//      200 + valid empty ResultList + @status='Complete' (W-5 + C-L1).
//   6. Unknown competition → 404.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-16-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, controls, courses, courseControls, competitors, events } from '../db/schema.ts';
import { validateXml } from '../xml/validate.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import type { HalfDayClock } from '@fartola/sportident';
import { clockToEpochMs, formatClockTime } from '../time/competitionClock.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });
  return { app, handle, nodeId };
}

function seedCompetitionWithThreeReads(handle: DbHandle, nodeId: string, id: string): void {
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
       VALUES (?, ?, ?, 'classic', 0, ?, 0)`
    )
    .run(id, 'StorTuna Tisdag', '2026-05-19', 1_000);
  const h21Id = `cls-${id}-h21`;
  const d21Id = `cls-${id}-d21`;
  handle.db.insert(classes).values({ id: h21Id, competitionId: id, name: 'H21' }).run();
  handle.db.insert(classes).values({ id: d21Id, competitionId: id, name: 'D21' }).run();

  const ctlId = `ctl-${id}-31`;
  handle.db.insert(controls).values({ id: ctlId, competitionId: id, code: 31 }).run();

  const courseH = `crs-${id}-h`;
  const courseD = `crs-${id}-d`;
  handle.db
    .insert(courses)
    .values({ id: courseH, competitionId: id, name: 'Bana H', classId: h21Id, lengthM: 1000 })
    .run();
  handle.db
    .insert(courses)
    .values({ id: courseD, competitionId: id, name: 'Bana D', classId: d21Id, lengthM: 900 })
    .run();
  handle.db
    .insert(courseControls)
    .values({ id: `cc-${id}-h-1`, courseId: courseH, controlId: ctlId, orderIdx: 0 })
    .run();
  handle.db
    .insert(courseControls)
    .values({ id: `cc-${id}-d-1`, courseId: courseD, controlId: ctlId, orderIdx: 0 })
    .run();

  // Anna — OK in H21.
  handle.db
    .insert(competitors)
    .values({
      id: `cmp-${id}-anna`,
      competitionId: id,
      name: 'Anna Andersson',
      club: 'StorTuna OK',
      classId: h21Id,
      cardNumber: 7501853,
      consentAtMs: 1_000,
      consentStatus: 'explicit',
      scrubbedAtMs: null,
    })
    .run();
  // Bo — MP in H21 (no punches).
  handle.db
    .insert(competitors)
    .values({
      id: `cmp-${id}-bo`,
      competitionId: id,
      name: 'Bo Berg',
      club: 'StorTuna OK',
      classId: h21Id,
      cardNumber: 1428824,
      consentAtMs: 1_000,
      consentStatus: 'explicit',
      scrubbedAtMs: null,
    })
    .run();
  // Cia — DNF in D21 (no finish on the card → reducer marks DNF).
  handle.db
    .insert(competitors)
    .values({
      id: `cmp-${id}-cia`,
      competitionId: id,
      name: 'Cia Carlsson',
      club: null,
      classId: d21Id,
      cardNumber: 248215,
      consentAtMs: 1_000,
      consentStatus: 'explicit',
      scrubbedAtMs: null,
    })
    .run();

  // Card reads. Anna OK (start+finish+punch 31). Bo MP (start+finish, NO
  // punch 31). Cia DNF (start, NO finish).
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq: 1,
      competitionId: id,
      eventType: 'card_read',
      eventTimeMs: 100,
      recordedAtMs: 100,
      payload: {
        event_type: 'card_read',
        card_number: 7501853,
        card_type: 'SI10',
        start: { half_day: 0, seconds_in_half_day: 9 * 3600, weekday: null },
        finish: { half_day: 0, seconds_in_half_day: 9 * 3600 + 12 * 60, weekday: null },
        check: null,
        clear: null,
        punch_count: 1,
        punches: [{ code: 31, seconds_in_half_day: 9 * 3600 + 6 * 60, half_day: 0, weekday: null }],
        card_holder: null,
      },
    })
    .run();
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq: 2,
      competitionId: id,
      eventType: 'card_read',
      eventTimeMs: 200,
      recordedAtMs: 200,
      payload: {
        event_type: 'card_read',
        card_number: 1428824,
        card_type: 'SI9',
        start: { half_day: 0, seconds_in_half_day: 9 * 3600, weekday: null },
        finish: { half_day: 0, seconds_in_half_day: 9 * 3600 + 13 * 60 + 20, weekday: null },
        check: null,
        clear: null,
        punch_count: 0,
        punches: [],
        card_holder: null,
      },
    })
    .run();
  handle.db
    .insert(events)
    .values({
      nodeId,
      localSeq: 3,
      competitionId: id,
      eventType: 'card_read',
      eventTimeMs: 300,
      recordedAtMs: 300,
      payload: {
        event_type: 'card_read',
        card_number: 248215,
        card_type: 'SI5',
        start: { half_day: 0, seconds_in_half_day: 9 * 3600, weekday: null },
        finish: null,
        check: null,
        clear: null,
        punch_count: 0,
        punches: [],
        card_holder: null,
      },
    })
    .run();
}

function seedEmptyCompetition(handle: DbHandle, id: string): void {
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
       VALUES (?, ?, ?, 'classic', 0, ?, 0)`
    )
    .run(id, 'Empty Tävling', '2026-05-19', 1_000);
  const h21Id = `cls-${id}-h21`;
  handle.db.insert(classes).values({ id: h21Id, competitionId: id, name: 'H21' }).run();
  // No competitors, no events.
}

const ALLOWED_STATUS = new Set(['Complete', 'Delta', 'Snapshot']);

describe('GET /api/competitions/:id/export[/preview]', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: preview returns valid=true with the expected summary counts', async () => {
    seedCompetitionWithThreeReads(ctx.handle, ctx.nodeId, 'comp-1');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-1/export/preview',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      valid: boolean;
      summary?: { class_count: number; person_result_count: number; status: string };
      errors?: unknown;
    };
    assert.equal(body.valid, true, `expected valid; got ${JSON.stringify(body.errors)}`);
    assert.equal(body.summary?.class_count, 2);
    assert.equal(body.summary?.person_result_count, 3);
    assert.equal(body.summary?.status, 'Final');
  });

  test('test 2: format=iof30 returns 200 with application/xml and W-4 enum-compliant @status', async () => {
    seedCompetitionWithThreeReads(ctx.handle, ctx.nodeId, 'comp-2');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-2/export?format=iof30',
    });
    assert.equal(res.statusCode, 200);
    const ct = res.headers['content-type'];
    assert.ok(
      typeof ct === 'string' && ct.includes('application/xml'),
      `unexpected content-type: ${ct}`
    );
    const cd = res.headers['content-disposition'];
    assert.ok(
      typeof cd === 'string' && /attachment; filename=".+-resultlist\.xml"/.test(cd),
      `unexpected content-disposition: ${cd}`
    );
    const xml = res.body;
    // XSD round-trip via the bundled IOF.xsd.
    const valid = await validateXml(xml);
    assert.equal(
      valid.valid,
      true,
      `expected XSD-valid body; got: ${JSON.stringify(valid.errors)}`
    );
    // Parse for the W-4 enum gate.
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml) as { ResultList: { '@_status': string } };
    assert.ok(
      ALLOWED_STATUS.has(parsed.ResultList['@_status']),
      `@status="${parsed.ResultList['@_status']}" must be in {Complete, Delta, Snapshot}`
    );
    assert.equal(parsed.ResultList['@_status'], 'Complete');
  });

  test('SOFT TR 7.8.2: the exported ResultList shows each class with its course length and the Eventor person ids', async () => {
    seedCompetitionWithThreeReads(ctx.handle, ctx.nodeId, 'comp-len');
    ctx.handle.db
      .update(competitors)
      .set({ eventorPersonId: 4711 })
      .where(eq(competitors.id, 'cmp-comp-len-anna'))
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-len/export?format=iof30',
    });
    assert.equal(res.statusCode, 200);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(res.body) as {
      ResultList: {
        ClassResult: Array<{
          Class: { Name: string };
          Course: { Name: string; Length: number };
          PersonResult: Array<{ Person: { Id?: { '#text': number; '@_type': string } } }>;
        }>;
      };
    };
    const byClass = new Map(parsed.ResultList.ClassResult.map((c) => [c.Class.Name, c]));
    assert.equal(byClass.get('H21')?.Course.Length, 1000);
    assert.equal(byClass.get('D21')?.Course.Length, 900);
    const ids = byClass.get('H21')!.PersonResult.map((p) => p.Person.Id ?? null);
    assert.deepEqual(ids, [{ '#text': 4711, '@_type': 'Sweden' }, null]);
  });

  test('test 3: unsupported format → 400', async () => {
    seedCompetitionWithThreeReads(ctx.handle, ctx.nodeId, 'comp-3');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-3/export?format=csv',
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string };
    assert.equal(body.error, 'unsupported_format');
  });

  test('test 4: status=Provisional → summary.status=Provisional; XML @status=Snapshot', async () => {
    seedCompetitionWithThreeReads(ctx.handle, ctx.nodeId, 'comp-4');
    const preview = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-4/export/preview?status=Provisional',
    });
    assert.equal(preview.statusCode, 200);
    const previewBody = preview.json() as {
      valid: boolean;
      summary?: { status: string };
    };
    assert.equal(previewBody.valid, true);
    assert.equal(previewBody.summary?.status, 'Provisional');

    const download = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-4/export?format=iof30&status=Provisional',
    });
    assert.equal(download.statusCode, 200);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(download.body) as { ResultList: { '@_status': string } };
    assert.equal(parsed.ResultList['@_status'], 'Snapshot');
  });

  test('test 5 (W-5 + C-L1): empty competition default-status returns 200 + valid + @status=Complete', async () => {
    seedEmptyCompetition(ctx.handle, 'comp-5');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/comp-5/export?format=iof30',
    });
    assert.equal(res.statusCode, 200, `expected 200 (W-5); body=${res.body}`);
    const ct = res.headers['content-type'];
    assert.ok(typeof ct === 'string' && ct.includes('application/xml'));
    // Body parses; root is ResultList; @status=Complete (C-L1 default-status
    // lock); zero ClassResult children (W-5 empty-competition lock).
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(res.body) as {
      ResultList: { '@_status': string; ClassResult?: unknown };
    };
    assert.equal(parsed.ResultList['@_status'], 'Complete');
    const cr = parsed.ResultList.ClassResult;
    const crCount = cr === undefined ? 0 : Array.isArray(cr) ? cr.length : 1;
    assert.equal(crCount, 0, 'empty competition must emit zero ClassResult children');

    // The XML body MUST also pass XSD validation (W-5 regression gate).
    const valid = await validateXml(res.body);
    assert.equal(
      valid.valid,
      true,
      `empty competition export must be XSD-valid; got ${JSON.stringify(valid.errors)}`
    );
  });

  test('test 6: unknown competition → 404', async () => {
    const previewRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/does-not-exist/export/preview',
    });
    assert.equal(previewRes.statusCode, 404);

    const downloadRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/does-not-exist/export?format=iof30',
    });
    assert.equal(downloadRes.statusCode, 404);
  });
});

// ADR-0012: card clocks and exported instants on one competition clock, a
// fixed offset per competition (the zone's at noon of the date, or the
// operator's clock_offset_min).
describe('ResultList times on the competition clock (ADR-0012)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  const hd = (h: number, m: number): HalfDayClock => {
    const sec = h * 3600 + m * 60;
    return { half_day: sec >= 43_200 ? 1 : 0, seconds_in_half_day: sec % 43_200, weekday: null };
  };

  /** One runner in H21 (no course) with a start punch and a finish, read at
   * `readAtMs` on the laptop. */
  function seedRun(
    id: string,
    date: string,
    start: [number, number],
    finish: [number, number],
    readAtMs: number
  ): void {
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
         VALUES (?, 'Natt', ?, 'classic', 0, 0, 0)`
      )
      .run(id, date);
    ctx.handle.db
      .insert(classes)
      .values({ id: `${id}-h21`, competitionId: id, name: 'H21' })
      .run();
    ctx.handle.db
      .insert(competitors)
      .values({
        id: `${id}-x`,
        competitionId: id,
        name: 'Xenia Ek',
        classId: `${id}-h21`,
        cardNumber: 1,
      })
      .run();
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: ctx.nodeId,
        localSeq: 1,
        competitionId: id,
        eventType: 'card_read',
        eventTimeMs: readAtMs,
        recordedAtMs: readAtMs,
        payload: {
          event_type: 'card_read',
          card_number: 1,
          card_type: 'SI10',
          start: hd(...start),
          finish: hd(...finish),
          check: null,
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
  }

  async function result(
    id: string
  ): Promise<{ StartTime: string; FinishTime: string; Time: number }> {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${id}/export?format=iof30`,
    });
    assert.equal(res.statusCode, 200, res.body);
    const parsed = new XMLParser({ parseTagValue: false }).parse(res.body) as {
      ResultList: {
        ClassResult: {
          PersonResult: { Result: { StartTime: string; FinishTime: string; Time: string } };
        };
      };
    };
    const r = parsed.ResultList.ClassResult.PersonResult.Result;
    return { StartTime: r.StartTime, FinishTime: r.FinishTime, Time: Number(r.Time) };
  }

  test('autumn night: 02:50 → 03:10 station time is 20 min, one instant each', async () => {
    // 2026-10-25, the repeated hour; read 03:15 CET. Default offset +01:00.
    seedRun('autumn', '2026-10-25', [2, 50], [3, 10], Date.parse('2026-10-25T02:15:00Z'));
    const r = await result('autumn');
    assert.equal(r.Time, 20 * 60);
    assert.equal(r.StartTime, '2026-10-25T02:50:00+01:00');
    assert.equal(r.FinishTime, '2026-10-25T03:10:00+01:00');
    assert.equal(Date.parse(r.StartTime), Date.parse('2026-10-25T01:50:00Z'));
  });

  test('midnight: 23:50 → 00:10 is 20 min', async () => {
    seedRun('midnight', '2026-10-03', [23, 50], [0, 10], Date.parse('2026-10-03T22:15:00Z'));
    const r = await result('midnight');
    assert.equal(r.Time, 20 * 60);
    assert.equal(r.StartTime, '2026-10-03T23:50:00+02:00');
    assert.equal(r.FinishTime, '2026-10-04T00:10:00+02:00');
  });

  // Starts are defined on the competition clock: correcting the offset
  // keeps a drawn 01:50 at 01:50, so the result and the start-punch check
  // are unchanged and only the exported instants move.
  test('override +60 after a draw: the start stays 01:50, the result 80 min', async () => {
    const date = '2026-03-29';
    seedRun('drawn', date, [1, 50], [3, 10], Date.parse('2026-03-29T01:20:00Z'));
    const draw = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/drawn/lottning/drawn-h21',
      payload: {
        mode: 'Simultaneous',
        firstStartMs: clockToEpochMs(date, 3600 + 50 * 60, 120),
        intervalSec: 0,
      },
    });
    assert.equal(draw.statusCode, 201, draw.body);
    const view = () => ctx.app.projectionStore.recomputeNow('drawn')!.competitors.get('drawn-x')!;
    const startText = async (): Promise<{ runner: string; first: string }> => {
      const offset = (
        (await ctx.app.inject({ method: 'GET', url: '/api/competitions/drawn' })).json() as {
          competition: { clock_offset_min: number };
        }
      ).competition.clock_offset_min;
      const runner = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, 'drawn-x'))
        .get()!;
      const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, 'drawn-h21')).get()!;
      return {
        runner: formatClockTime(runner.startTimeMs!, offset),
        first: formatClockTime(cls.firstStartMs!, offset),
      };
    };
    assert.equal(view().elapsed_time_ms, 80 * 60 * 1000);
    assert.equal(view().late_start_ms, null);
    assert.deepEqual(await startText(), { runner: '01:50:00', first: '01:50:00' });
    const before = await result('drawn');

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/drawn',
      payload: { clock_offset_min: 60 },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.equal(view().elapsed_time_ms, 80 * 60 * 1000);
    assert.equal(view().late_start_ms, null);
    assert.equal(view().early_start_ms, null);
    assert.deepEqual(await startText(), { runner: '01:50:00', first: '01:50:00' });
    const after = await result('drawn');
    assert.equal(after.Time, 80 * 60);
    assert.equal(after.StartTime, '2026-03-29T01:50:00+01:00');
    assert.equal(Date.parse(after.StartTime) - Date.parse(before.StartTime), 3600_000);

    // A date with another default offset shifts the same way.
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/drawn',
      payload: { clock_offset_min: null, date: '2026-06-01' }, // +60 → +120
    });
    assert.deepEqual(await startText(), { runner: '01:50:00', first: '01:50:00' });
  });

  // A night race dated the Sunday it ends, stations synced on CET the
  // evening before: the default (+02:00 at noon of 2026-03-29) puts the
  // exported instants an hour early until the operator sets +60.
  test('override +60: exported instants shift, the running time does not', async () => {
    seedRun('spring', '2026-03-29', [1, 50], [3, 10], Date.parse('2026-03-29T01:20:00Z'));
    const before = await result('spring');
    assert.equal(before.Time, 80 * 60);
    assert.equal(before.StartTime, '2026-03-29T01:50:00+02:00');

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/spring',
      payload: { clock_offset_min: 60 },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.equal((patch.json() as { clock_offset_min: number }).clock_offset_min, 60);

    const after = await result('spring');
    assert.equal(after.Time, 80 * 60);
    assert.equal(after.StartTime, '2026-03-29T01:50:00+01:00');
    assert.equal(after.FinishTime, '2026-03-29T03:10:00+01:00');
    assert.equal(Date.parse(after.StartTime) - Date.parse(before.StartTime), 3600_000);

    // Beyond UTC−12 … UTC+14, or not whole minutes → 400.
    for (const clock_offset_min of [900, 60.5]) {
      const bad = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/competitions/spring',
        payload: { clock_offset_min },
      });
      assert.equal(bad.statusCode, 400, String(clock_offset_min));
    }

    // null clears the override: back to the date's default.
    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/competitions/spring',
      payload: { clock_offset_min: null },
    });
    assert.equal((cleared.json() as { clock_offset_min: number }).clock_offset_min, 120);
  });
});
