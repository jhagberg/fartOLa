// Authored for fartola. Not ported from upstream.
//
// node:test coverage for "Fastställ saknade starttider" (02.1-14 Task 15):
// GET /api/competitions/:id/missing-starts lists every runner flagged
// missing_start with the day's check → start numbers, and POST
// …/missing-starts/apply sets their start times in one transaction.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';
import type { HalfDayClock } from '@fartola/sportident';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, competitors, controls, courseControls, courses, events } from '../db/schema.ts';
import { clockToEpochMs, formatClockTime, localToEpochMs } from '../time/competitionClock.ts';

const DAY = '2026-05-14';
const COMP = 'comp-ms';
const at = (sec: number): number => localToEpochMs(DAY, sec);
const hd = (sec: number): HalfDayClock => ({
  seconds_in_half_day: sec % 43200,
  half_day: sec >= 43200 ? 1 : 0,
  weekday: null,
});

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
}

interface Listing {
  n: number;
  median_ms: number | null;
  mean_ms: number | null;
  offset_ms: number;
  items: Array<{
    competitor_id: string;
    name: string;
    class_name: string;
    status: string;
    check_ms: number | null;
    suggested_start_ms: number | null;
    finish_ms: number;
  }>;
}

let seq = 0;
function read(ctx: Ctx, card: number, check: number | null, start: number | null): void {
  seq++;
  ctx.handle.db
    .insert(events)
    .values({
      nodeId: ctx.nodeId,
      localSeq: seq,
      competitionId: COMP,
      eventType: 'card_read',
      eventTimeMs: at(11 * 3600 + seq),
      recordedAtMs: at(11 * 3600 + seq),
      payload: {
        event_type: 'card_read',
        card_number: card,
        card_type: 'SI10',
        start: start === null ? null : hd(start),
        finish: hd(10 * 3600 + 40 * 60),
        check: check === null ? null : hd(check),
        clear: null,
        punch_count: 1,
        punches: [{ code: 31, ...hd(10 * 3600 + 20 * 60) }],
        card_holder: null,
      },
    })
    .run();
}

function addRunner(ctx: Ctx, id: string, name: string, card: number): void {
  ctx.handle.db
    .insert(competitors)
    .values({ id, competitionId: COMP, name, classId: 'cls', cardNumber: card })
    .run();
}

/** Ten reference runners with check 10:00 and start gaps 60 s ×9 and 600 s
 * (median 1:00, mean 1:54), plus x (check 10:05, no start) and y (no check,
 * no start). */
function seed(ctx: Ctx): void {
  ctx.handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
       VALUES (?, 'Prov', ?, 'classic', 0, 0, 0)`
    )
    .run(COMP, DAY);
  ctx.handle.db.insert(classes).values({ id: 'cls', competitionId: COMP, name: 'H21' }).run();
  ctx.handle.db.insert(controls).values({ id: 'ctl', competitionId: COMP, code: 31 }).run();
  ctx.handle.db
    .insert(courses)
    .values({ id: 'crs', competitionId: COMP, name: 'A', classId: 'cls', lengthM: 1000 })
    .run();
  ctx.handle.db
    .insert(courseControls)
    .values({ id: 'cc', courseId: 'crs', controlId: 'ctl', orderIdx: 0 })
    .run();
  for (let i = 0; i < 10; i++) {
    addRunner(ctx, `r${i}`, `Ref ${i}`, 100 + i);
    read(ctx, 100 + i, 10 * 3600, 10 * 3600 + (i === 9 ? 600 : 60));
  }
  addRunner(ctx, 'x', 'Xenia', 1);
  read(ctx, 1, 10 * 3600 + 5 * 60, null);
  addRunner(ctx, 'y', 'Ylva', 2);
  read(ctx, 2, null, null);
}

describe('missing starts (02.1-14 Task 15)', () => {
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
    ctx = { app, handle, nodeId };
    seq = 0;
    seed(ctx);
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  const list = async (): Promise<Listing> => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${COMP}/missing-starts`,
    });
    assert.equal(res.statusCode, 200);
    return res.json() as Listing;
  };
  const apply = (items: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${COMP}/missing-starts/apply`,
      payload: { items },
    });
  const startOf = (id: string): number | null =>
    ctx.handle.db.select().from(competitors).where(eq(competitors.id, id)).get()?.startTimeMs ??
    null;

  test('GET lists the runners without a start, with check, suggestion and the day stats', async () => {
    const body = await list();
    assert.deepEqual(
      { n: body.n, median_ms: body.median_ms, mean_ms: body.mean_ms, offset_ms: body.offset_ms },
      { n: 10, median_ms: 60_000, mean_ms: 114_000, offset_ms: 60_000 }
    );
    assert.deepEqual(
      body.items.map((i) => [i.competitor_id, i.name, i.class_name, i.status]),
      [
        ['x', 'Xenia', 'H21', 'OK'],
        ['y', 'Ylva', 'H21', 'OK'],
      ]
    );
    const [x, y] = body.items;
    assert.equal(x!.check_ms, at(10 * 3600 + 5 * 60));
    assert.equal(x!.suggested_start_ms, at(10 * 3600 + 6 * 60));
    assert.equal(x!.finish_ms, at(10 * 3600 + 40 * 60));
    assert.equal(y!.check_ms, null);
    assert.equal(y!.suggested_start_ms, null);
  });

  test('GET for an unknown competition → 404', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/competitions/nope/missing-starts',
    });
    assert.equal(res.statusCode, 404);
  });

  test('apply sets every start time; the runners get times and places', async () => {
    const res = await apply([
      { competitor_id: 'x', start_time_ms: at(10 * 3600 + 6 * 60) },
      { competitor_id: 'y', start_time_ms: at(10 * 3600 + 10 * 60) },
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { updated: 2 });
    assert.equal(startOf('x'), at(10 * 3600 + 6 * 60));

    const state = ctx.app.projectionStore.recomputeNow(COMP)!;
    assert.equal(state.competitors.get('x')!.elapsed_time_ms, 34 * 60 * 1000);
    assert.equal(state.competitors.get('y')!.elapsed_time_ms, 30 * 60 * 1000);
    const rows = state.results_by_class.get('cls')!;
    assert.equal(rows.find((r) => r.competitor_id === 'y')!.place !== null, true);
    assert.equal(rows.find((r) => r.competitor_id === 'x')!.place !== null, true);
    assert.deepEqual((await list()).items, []);
  });

  // SOFT TR 4.20.6: a finish by hand for a read without a finish punch (w)
  // or without any read-out (z, card missing): with no start either, both
  // are listed with that finish, and a start makes them timed.
  test('finishes by hand without a start are listed and can be completed', async () => {
    addRunner(ctx, 'w', 'Wilma', 3);
    seq++;
    ctx.handle.db
      .insert(events)
      .values({
        nodeId: ctx.nodeId,
        localSeq: seq,
        competitionId: COMP,
        eventType: 'card_read',
        eventTimeMs: at(11 * 3600 + seq),
        recordedAtMs: at(11 * 3600 + seq),
        payload: {
          event_type: 'card_read',
          card_number: 3,
          card_type: 'SI10',
          start: null,
          finish: null,
          check: null,
          clear: null,
          punch_count: 1,
          punches: [{ code: 31, ...hd(10 * 3600 + 20 * 60) }],
          card_holder: null,
        },
      })
      .run();
    addRunner(ctx, 'z', 'Zara', 4);
    for (const id of ['w', 'z']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${COMP}/competitors/${id}/manual-finish`,
        payload: { finish_ms: at(10 * 3600 + 45 * 60), reason: 'Målenheten' },
      });
      assert.equal(res.statusCode, 201);
    }
    const listed = (await list()).items.filter(
      (i) => i.competitor_id === 'w' || i.competitor_id === 'z'
    );
    assert.deepEqual(
      listed.map((i) => [i.competitor_id, i.finish_ms]),
      [
        ['w', at(10 * 3600 + 45 * 60)],
        ['z', at(10 * 3600 + 45 * 60)],
      ]
    );
    const res = await apply([
      { competitor_id: 'w', start_time_ms: at(10 * 3600) },
      { competitor_id: 'z', start_time_ms: at(10 * 3600 + 5 * 60) },
    ]);
    assert.equal(res.statusCode, 200);
    const state = ctx.app.projectionStore.recomputeNow(COMP)!;
    assert.equal(state.competitors.get('w')!.elapsed_time_ms, 45 * 60 * 1000);
    assert.equal(state.competitors.get('z')!.elapsed_time_ms, 40 * 60 * 1000);
  });

  test('a validation error rolls back the whole batch (400)', async () => {
    const res = await apply([
      { competitor_id: 'x', start_time_ms: at(10 * 3600 + 6 * 60) },
      // Local ms since midnight, the old base: rejected like the PATCH route.
      { competitor_id: 'y', start_time_ms: 36_000_000 },
    ]);
    assert.equal(res.statusCode, 400);
    assert.equal(startOf('x'), null);
    assert.equal(startOf('y'), null);
  });

  test('an unknown competitor rolls back the whole batch (404)', async () => {
    const res = await apply([
      { competitor_id: 'x', start_time_ms: at(10 * 3600 + 6 * 60) },
      { competitor_id: 'nobody', start_time_ms: at(10 * 3600 + 10 * 60) },
    ]);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: 'competitor_not_found', competitor_id: 'nobody' });
    assert.equal(startOf('x'), null);
  });

  test('an empty batch → 400', async () => {
    assert.equal((await apply([])).statusCode, 400);
  });
});

// Codex third review of #51, finding 3. 2026-03-29: the clocks go 02:00 →
// 03:00, SI stations don't. Check 01:59, no start, finish 02:30, read at
// 03:35 on the laptop: the suggestion is station time 02:00:54 (check +
// 1:54). On the civil clock it had no instant of its own; on the
// competition clock (one fixed offset, ADR-0012) it is an ordinary epoch,
// so start_time_ms alone times the runner.
describe('missing start suggested in the skipped spring hour', () => {
  const SPRING = '2026-03-29';
  const OFFSET = 120; // the default: CEST at noon of SPRING
  const clock = (sec: number): number => clockToEpochMs(SPRING, sec, OFFSET);
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
    ctx = { app, handle, nodeId };
    handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, race_started_at_ms)
         VALUES (?, 'Natt', ?, 'classic', 0, 0, 0)`
      )
      .run(COMP, SPRING);
    handle.db.insert(classes).values({ id: 'cls', competitionId: COMP, name: 'H21' }).run();
    addRunner(ctx, 'x', 'Xenia Ek', 1);
    const readAt = localToEpochMs(SPRING, 3 * 3600 + 35 * 60);
    handle.db
      .insert(events)
      .values({
        nodeId,
        localSeq: 1,
        competitionId: COMP,
        eventType: 'card_read',
        eventTimeMs: readAt,
        recordedAtMs: readAt,
        payload: {
          event_type: 'card_read',
          card_number: 1,
          card_type: 'SI10',
          start: null,
          finish: hd(2 * 3600 + 30 * 60),
          check: hd(3600 + 59 * 60),
          clear: null,
          punch_count: 0,
          punches: [],
          card_holder: null,
        },
      })
      .run();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  const elapsedOfX = (): number | null =>
    ctx.app.projectionStore.recomputeNow(COMP)!.competitors.get('x')!.elapsed_time_ms;

  test('the listed suggestion, applied as start_time_ms, times the runner', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${COMP}/missing-starts`,
    });
    const body = res.json() as {
      clock_offset_min: number;
      items: Array<Record<string, number | null>>;
    };
    const item = body.items[0]!;
    assert.equal(body.clock_offset_min, OFFSET);
    assert.equal(formatClockTime(item['suggested_start_ms']!, OFFSET), '02:00:54');
    assert.equal(formatClockTime(item['check_ms']!, OFFSET), '01:59:00');
    assert.equal(formatClockTime(item['finish_ms']!, OFFSET), '02:30:00');

    const applied = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${COMP}/missing-starts/apply`,
      payload: { items: [{ competitor_id: 'x', start_time_ms: item['suggested_start_ms'] }] },
    });
    assert.equal(applied.statusCode, 200, applied.body);
    const x = ctx.app.projectionStore.recomputeNow(COMP)!.competitors.get('x')!;
    assert.equal(x.status, 'OK');
    assert.equal(x.missing_start, false);
    assert.equal(x.elapsed_time_ms, (29 * 60 + 6) * 1000);
    // One column: the start is start_time_ms and nothing else.
    const columns = ctx.handle.sqlite
      .prepare<unknown[], { name: string }>("SELECT name FROM pragma_table_info('competitors')")
      .all()
      .map((c) => c.name);
    assert.equal(columns.includes('start_wall_ms'), false);
    const row = ctx.handle.db.select().from(competitors).where(eq(competitors.id, 'x')).get();
    assert.equal(row?.startTimeMs, item['suggested_start_ms']);
  });

  test('PATCH start-time: a start in the skipped hour; start_wall is gone', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${COMP}/competitors/x/start-time`,
      payload: { start_time_ms: clock(2 * 3600 + 10 * 60) },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(elapsedOfX(), 20 * 60 * 1000);
    for (const payload of [
      { start_wall: `${SPRING}T02:10:00` },
      { start_wall: `${SPRING}T02:10:00`, start_time_ms: clock(3600) },
    ]) {
      const bad = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/competitions/${COMP}/competitors/x/start-time`,
        payload,
      });
      assert.equal(bad.statusCode, 400, JSON.stringify(payload));
    }
  });

  // Codex: a redraw to civil 03:00:54 gave the same epoch as an old 02:00:54
  // override, so the stale override still counted. One column: the last
  // writer wins, whoever it is.
  test('a redraw after a manual start: the drawn start counts', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${COMP}/competitors/x/start-time`,
      payload: { start_time_ms: clock(2 * 3600 + 54) },
    });
    assert.equal(elapsedOfX(), (29 * 60 + 6) * 1000);
    // 03:00:54 on the old civil clock is 01:00:54Z, the old override's epoch.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${COMP}/lottning/cls`,
      payload: { mode: 'Simultaneous', firstStartMs: clock(3600 + 50 * 60), intervalSec: 0 },
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(elapsedOfX(), 40 * 60 * 1000);
  });

  test('an IOF StartList import after a manual start: the imported start counts', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/competitions/${COMP}/competitors/x/start-time`,
      payload: { start_time_ms: clock(2 * 3600 + 54) },
    });
    // An offset-free StartTime is on the competition clock.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
           createTime="2026-03-28T18:00:00Z" creator="test">
  <Event><Name>Natt</Name><StartTime><Date>${SPRING}</Date></StartTime></Event>
  <ClassStart><Class><Name>H21</Name></Class>
    <PersonStart>
      <Person><Name><Family>Ek</Family><Given>Xenia</Given></Name></Person>
      <Start>
        <StartTime>${SPRING}T01:50:00</StartTime>
        <ControlCard punchingSystem="SI">1</ControlCard>
      </Start>
    </PersonStart>
  </ClassStart>
</StartList>`;
    const form = new FormData();
    form.set('file', new File([xml], 'startlist.xml', { type: 'application/xml' }));
    const req = new Request('http://x/', { method: 'POST', body: form });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${COMP}/import/startlist`,
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal((res.json() as { exact: number }).exact, 1);
    assert.equal(elapsedOfX(), 40 * 60 * 1000);
  });
});
