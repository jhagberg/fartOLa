// Authored for fartola. Not ported from upstream.
//
// TDD tests for the lottning (start list draw) route.
// Phase 2.1 D-03/D-04/D-05/D-06/D-07.
//
// Routes tested:
//   POST /api/competitions/:id/lottning/:classId
//   GET  /api/competitions/:id/lottning/:classId
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-02-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';

import type { ClassKind, CompetitionLevel } from '@fartola/shared-types';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';
import { competitions, classes, competitors } from '../db/schema.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

/** Epoch ms at h:m local on the test competition's date (2026-05-24). */
const at = (h: number, m = 0): number => localToEpochMs('2026-05-24', h * 3600 + m * 60);

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
  classId: string;
  otherClassId: string;
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

  // Create a competition
  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Test Cup',
      date: '2026-05-24',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
    })
    .run();

  // Create two classes
  const classId = crypto.randomUUID();
  const otherClassId = crypto.randomUUID();
  handle.db
    .insert(classes)
    .values([
      {
        id: classId,
        competitionId,
        name: 'H21',
        shortName: null,
        firstStartMs: null,
        startIntervalSec: null,
        maxTimeSec: null,
        classKind: 'senior',
        ageClass: 21,
        classKindSource: 'operator',
      },
      {
        id: otherClassId,
        competitionId,
        name: 'D21',
        shortName: null,
        firstStartMs: null,
        startIntervalSec: null,
        maxTimeSec: null,
        classKind: 'senior',
        ageClass: 21,
        classKindSource: 'operator',
      },
    ])
    .run();

  // Insert 5 competitors in H21 from 2 clubs
  const h21Runners: Array<[string, number]> = [
    ['Alpha', 3],
    ['Beta', 2],
  ];
  let idx = 0;
  for (const [club, count] of h21Runners) {
    for (let i = 0; i < count; i++) {
      handle.db
        .insert(competitors)
        .values({
          id: crypto.randomUUID(),
          competitionId,
          name: `Runner ${idx++}`,
          club,
          classId,
          cardNumber: null,
          consentAtMs: null,
          consentStatus: 'explicit',
          scrubbedAtMs: null,
          source: 'walkup',
          startTimeMs: null,
        })
        .run();
    }
  }

  // Insert 3 competitors in D21
  for (let i = 0; i < 3; i++) {
    handle.db
      .insert(competitors)
      .values({
        id: crypto.randomUUID(),
        competitionId,
        name: `D-Runner ${i}`,
        club: 'Gamma',
        classId: otherClassId,
        cardNumber: null,
        consentAtMs: null,
        consentStatus: 'explicit',
        scrubbedAtMs: null,
        source: 'walkup',
        startTimeMs: null,
      })
      .run();
  }

  return { app, handle, competitionId, classId, otherClassId };
}

describe('lottning route', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: POST SOFT → 201 with { drawn: 5 }, all competitors have start_time_ms', async () => {
    const firstStartMs = at(10);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const nonNull = rows.filter((r) => r.startTimeMs !== null);
    assert.equal(nonNull.length, 5);
  });

  test('test 2: start_time_ms values spaced by intervalSec', async () => {
    // Every runner in the class gets a time, and the times are exactly
    // first, first + interval, … — in both interval modes (SOFT TR 7.4.1,
    // 7.4.4: the same interval through the class).
    const firstStartMs = localToEpochMs('2026-05-24', 10 * 3600);
    for (const [mode, intervalSec] of [
      ['SOFT', 60],
      ['Random', 120],
    ] as const) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
        payload: { mode, firstStartMs, intervalSec },
      });
      assert.equal(res.statusCode, 201, res.body);
      const times = ctx.handle.db
        .select({ startTimeMs: competitors.startTimeMs })
        .from(competitors)
        .where(eq(competitors.classId, ctx.classId))
        .all()
        .map((r) => r.startTimeMs)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      assert.deepEqual(
        times,
        [0, 1, 2, 3, 4].map((k) => firstStartMs + k * intervalSec * 1000),
        mode
      );
    }
  });

  test('SOFT TR 7.5.1: an entry without a name is not drawn (no start time)', async () => {
    const unnamed = crypto.randomUUID();
    ctx.handle.db
      .insert(competitors)
      .values({
        id: unnamed,
        competitionId: ctx.competitionId,
        name: '  ',
        club: 'Alpha',
        classId: ctx.classId,
      })
      .run();
    for (const mode of ['SOFT', 'Random', 'Simultaneous'] as const) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
        payload: { mode, firstStartMs: localToEpochMs('2026-05-24', 36_000), intervalSec: 60 },
      });
      assert.equal(res.statusCode, 201, res.body);
      assert.equal((res.json() as { drawn: number }).drawn, 5, mode);
      const rows = ctx.handle.db
        .select({ id: competitors.id, startTimeMs: competitors.startTimeMs })
        .from(competitors)
        .where(eq(competitors.classId, ctx.classId))
        .all();
      assert.equal(rows.find((r) => r.id === unnamed)!.startTimeMs, null, mode);
      assert.equal(rows.filter((r) => r.startTimeMs !== null).length, 5, mode);
    }
  });

  test('test 3: vacant slots create gaps in the time sequence', async () => {
    const firstStartMs = at(10);
    const intervalSec = 60;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec, vacantSlots: 2 },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    // SOFT TR 7.3.2/7.5.2: the 2 vacancies are random places on the grid,
    // so the 5 runners take 5 distinct places among the 7.
    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const slots = rows.map(
      (r) => ((r.startTimeMs as number) - firstStartMs) / (intervalSec * 1000)
    );
    assert.equal(new Set(slots).size, 5, `slots ${slots.join(',')}`);
    for (const k of slots) assert.ok(Number.isInteger(k) && k >= 0 && k < 7, `slot ${k}`);
  });

  test('test 4: POST mode=Random → 201, all competitors have start_time_ms', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: at(9), intervalSec: 120 },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json() as { drawn: number };
    assert.equal(body.drawn, 5);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const nonNull = rows.filter((r) => r.startTimeMs !== null);
    assert.equal(nonNull.length, 5);
  });

  test('test 5: POST mode=Simultaneous → all competitors have same start_time_ms', async () => {
    const firstStartMs = at(11);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Simultaneous', firstStartMs, intervalSec: 0 },
    });
    assert.equal(res.statusCode, 201, res.body);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const times = rows.map((r) => r.startTimeMs);
    // The whole class (5 runners), all at the same time (SOFT TR 7.4.1).
    assert.deepEqual(times, [firstStartMs, firstStartMs, firstStartMs, firstStartMs, firstStartMs]);
  });

  test('test 6: re-lotta clears old times, other class untouched', async () => {
    // First draw on H21
    const firstStartMs = at(10);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });

    // Draw D21
    const d21FirstStart = at(10, 5);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.otherClassId}`,
      payload: { mode: 'SOFT', firstStartMs: d21FirstStart, intervalSec: 60 },
    });

    // Re-lotta H21 with different time
    const newFirstStartMs = at(11);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: newFirstStartMs, intervalSec: 90 },
    });
    assert.equal(res.statusCode, 201);

    // H21 times must all be >= newFirstStartMs
    const h21Rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    const h21Times = h21Rows.map((r) => r.startTimeMs as number);
    assert.ok(
      h21Times.every((t) => t >= newFirstStartMs),
      `Some H21 times before new start: ${h21Times.join(',')}`
    );

    // D21 times should still be set (other class untouched)
    const d21Rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.otherClassId))
      .all();
    const d21NonNull = d21Rows.filter((r) => r.startTimeMs !== null);
    assert.equal(d21NonNull.length, 3, 'D21 times should still be set');
  });

  test('test 7: unknown class → 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${crypto.randomUUID()}`,
      payload: { mode: 'SOFT', firstStartMs: at(10), intervalSec: 60 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 8: class belongs to different competition → 404', async () => {
    const otherId = crypto.randomUUID();
    ctx.handle.db
      .insert(competitions)
      .values({
        id: otherId,
        name: 'Other Cup',
        date: '2026-05-25',
        receiptTemplate: 'classic',
        autoPrint: false,
        createdAtMs: Date.now(),
      })
      .run();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${otherId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs: at(10), intervalSec: 60 },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 9: classes.firstStartMs and startIntervalSec updated on class row after draw', async () => {
    const firstStartMs = at(10);
    const intervalSec = 90;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec },
    });

    const cls = ctx.handle.db
      .select({ firstStartMs: classes.firstStartMs, startIntervalSec: classes.startIntervalSec })
      .from(classes)
      .where(eq(classes.id, ctx.classId))
      .get();
    assert.equal(cls?.firstStartMs, firstStartMs);
    assert.equal(cls?.startIntervalSec, intervalSec);
  });

  test('test 10: intervalSec=0 with mode=SOFT → 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs: at(10), intervalSec: 0 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 10b: intervalSec=0 with mode=Random → 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Random', firstStartMs: at(10), intervalSec: 0 },
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 11: intervalSec=0 with mode=Simultaneous → 201', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'Simultaneous', firstStartMs: at(10), intervalSec: 0 },
    });
    assert.equal(res.statusCode, 201);
  });

  test('a firstStartMs that is not epoch ms (old ms-since-midnight base) → 400, nothing drawn', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs: 10 * 3600 * 1000, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 400, res.body);
    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .all();
    assert.ok(rows.every((r) => r.startTimeMs === null));
  });

  test('test 12 (02.1-14 Task 1): epoch firstStartMs is stored as epoch', async () => {
    const firstStartMs = localToEpochMs('2026-05-24', 10 * 3600);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });
    assert.equal(res.statusCode, 201, res.body);

    const rows = ctx.handle.db
      .select({ startTimeMs: competitors.startTimeMs })
      .from(competitors)
      .where(eq(competitors.classId, ctx.classId))
      .orderBy(asc(competitors.startTimeMs))
      .all();
    assert.equal(rows[0]?.startTimeMs, firstStartMs);
    for (const r of rows) assert.ok((r.startTimeMs ?? 0) > 1e12, `not epoch: ${r.startTimeMs}`);
  });

  test('GET lottning returns sorted start list', async () => {
    const firstStartMs = at(10);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload: { mode: 'SOFT', firstStartMs, intervalSec: 60 },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      class: { id: string; first_start_ms: number; start_interval_sec: number };
      start_list: Array<{ id: string; start_time_ms: number }>;
    };
    assert.equal(body.class.id, ctx.classId);
    assert.equal(body.start_list.length, 5);
    for (let i = 1; i < body.start_list.length; i++) {
      assert.ok(
        body.start_list[i]!.start_time_ms >= body.start_list[i - 1]!.start_time_ms,
        'Start list not sorted'
      );
    }
  });

  // ---- M1 helpers --------------------------------------------------------
  const post = (payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}`,
      payload,
    });
  const addRunner = (
    name: string,
    club: string | null,
    startTimeMs: number | null = null
  ): string => {
    const id = crypto.randomUUID();
    ctx.handle.db
      .insert(competitors)
      .values({
        id,
        competitionId: ctx.competitionId,
        name,
        club,
        classId: ctx.classId,
        startTimeMs,
      })
      .run();
    return id;
  };
  const timesOf = (): Map<string, number | null> =>
    new Map(
      ctx.handle.db
        .select({ id: competitors.id, startTimeMs: competitors.startTimeMs })
        .from(competitors)
        .where(eq(competitors.classId, ctx.classId))
        .all()
        .map((r) => [r.id, r.startTimeMs])
    );

  test('SOFT TR 7.3.2: Random draws vacancies too; First puts them before the class', async () => {
    const firstStartMs = at(10);
    const res = await post({
      mode: 'Random',
      firstStartMs,
      intervalSec: 60,
      vacantSlots: 2,
      vacantPosition: 'First',
    });
    assert.equal(res.statusCode, 201, res.body);
    const times = [...timesOf().values()].map(Number).sort((a, b) => a - b);
    assert.deepEqual(
      times,
      [2, 3, 4, 5, 6].map((k) => firstStartMs + k * 60_000)
    );
  });

  test('vacantPosition Last: the class starts at the first start, vacancies after it', async () => {
    const firstStartMs = at(10);
    const res = await post({
      mode: 'SOFT',
      firstStartMs,
      intervalSec: 60,
      vacantSlots: 3,
      vacantPosition: 'Last',
    });
    assert.equal(res.statusCode, 201, res.body);
    const times = [...timesOf().values()].map(Number).sort((a, b) => a - b);
    assert.deepEqual(
      times,
      [0, 1, 2, 3, 4].map((k) => firstStartMs + k * 60_000)
    );
  });

  test('SOFT TR 7.5.8: late entrants after the class (night) — the drawn runners keep their times', async () => {
    const firstStartMs = at(10);
    assert.equal((await post({ mode: 'SOFT', firstStartMs, intervalSec: 60 })).statusCode, 201);
    const before = timesOf();
    const x = addRunner('Late X', 'Gamma');
    const y = addRunner('Late Y', 'Delta');
    const res = await post({ mode: 'SOFT', drawType: 'RemainingAfter' });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal((res.json() as { drawn: number }).drawn, 2);
    const after = timesOf();
    for (const [id, t] of before) assert.equal(after.get(id), t, 'a drawn runner moved');
    assert.deepEqual(
      [after.get(x), after.get(y)].map(Number).sort((a, b) => a - b),
      [firstStartMs + 5 * 60_000, firstStartMs + 6 * 60_000]
    );
  });

  test('SOFT TR 7.5.8: late entrants before the class (day) — block ends one interval before the first start', async () => {
    const firstStartMs = at(10);
    assert.equal((await post({ mode: 'SOFT', firstStartMs, intervalSec: 60 })).statusCode, 201);
    const x = addRunner('Late X', 'Gamma');
    const res = await post({ mode: 'Random', drawType: 'RemainingBefore' });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(timesOf().get(x), firstStartMs - 60_000);
    const cls = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.classId)).get()!;
    assert.equal(cls.firstStartMs, firstStartMs - 60_000);
  });

  test('SOFT TR 7.5.8: late entrants take vacant places; not in an elite class (422)', async () => {
    const firstStartMs = at(10);
    assert.equal(
      (
        await post({
          mode: 'SOFT',
          firstStartMs,
          intervalSec: 60,
          vacantSlots: 2,
          vacantPosition: 'First',
        })
      ).statusCode,
      201
    );
    const x = addRunner('Late X', 'Gamma');
    const res = await post({ mode: 'SOFT', drawType: 'RemainingVacant' });
    assert.equal(res.statusCode, 201, res.body);
    assert.ok(
      [firstStartMs, firstStartMs + 60_000].includes(timesOf().get(x)!),
      'not a vacant place'
    );

    ctx.handle.db
      .update(classes)
      .set({ classKind: 'elit', ageClass: 21 })
      .where(eq(classes.id, ctx.classId))
      .run();
    addRunner('Late Z', 'Gamma');
    const elite = await post({ mode: 'SOFT', drawType: 'RemainingVacant' });
    assert.equal(elite.statusCode, 422, elite.body);
    assert.equal((elite.json() as { error: string }).error, 'vacancies_not_offered_in_elite');
  });

  test('late entrants without a start list → 409 no_start_list, nothing written', async () => {
    const res = await post({ mode: 'SOFT', drawType: 'RemainingAfter' });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((res.json() as { error: string }).error, 'no_start_list');
    assert.ok([...timesOf().values()].every((t) => t === null));
  });

  test('late entrants after an imported start list (no class interval) use the smallest gap', async () => {
    // A StartList import sets start times but not classes.start_interval_sec.
    const t0 = at(10);
    let k = 0;
    for (const id of timesOf().keys())
      ctx.handle.db
        .update(competitors)
        .set({ startTimeMs: t0 + k++ * 120_000 })
        .where(eq(competitors.id, id))
        .run();
    const x = addRunner('Late X', 'Gamma');
    const res = await post({ mode: 'SOFT', drawType: 'RemainingAfter' });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(timesOf().get(x), t0 + 5 * 120_000);
  });

  test('a second late-entrant draw with nobody new is a no-op', async () => {
    assert.equal(
      (await post({ mode: 'SOFT', firstStartMs: at(10), intervalSec: 60 })).statusCode,
      201
    );
    addRunner('Late X', 'Gamma');
    assert.equal((await post({ mode: 'SOFT', drawType: 'RemainingAfter' })).statusCode, 201);
    const before = timesOf();
    const again = await post({ mode: 'SOFT', drawType: 'RemainingAfter' });
    assert.equal(again.statusCode, 201, again.body);
    assert.equal((again.json() as { drawn: number }).drawn, 0);
    assert.deepEqual(timesOf(), before);
  });

  test('a refusing rule needs a confirmed class kind: a name suggestion → 409 class_kind_unconfirmed', async () => {
    const firstStartMs = at(10);
    assert.equal((await post({ mode: 'SOFT', firstStartMs, intervalSec: 60 })).statusCode, 201);
    addRunner('Late X', 'Gamma');
    ctx.handle.db
      .update(classes)
      .set({ classKindSource: 'name' })
      .where(eq(classes.id, ctx.classId))
      .run();
    const res = await post({ mode: 'SOFT', drawType: 'RemainingVacant' });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((res.json() as { error: string }).error, 'class_kind_unconfirmed');
    ctx.handle.db
      .update(classes)
      .set({ classKind: null, classKindSource: null })
      .where(eq(classes.id, ctx.classId))
      .run();
    const none = await post({ mode: 'SOFT', drawType: 'RemainingVacant' });
    assert.equal((none.json() as { error: string }).error, 'class_kind_unknown');
  });

  const setKind = (classKind: ClassKind | null, ageClass: number | null = null) =>
    ctx.handle.db
      .update(classes)
      .set({ classKind, ageClass })
      .where(eq(classes.id, ctx.classId))
      .run();
  const setLevel = (level: CompetitionLevel | null) =>
    ctx.handle.db
      .update(competitions)
      .set({ level })
      .where(eq(competitions.id, ctx.competitionId))
      .run();
  const putSeeding = (groups: string[][]) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/api/competitions/${ctx.competitionId}/lottning/${ctx.classId}/seeding`,
      payload: { groups },
    });

  test('SOFT TR 7.4.5: Seeded — stored seeding groups start last, and a redraw reuses them', async () => {
    setKind('elit', 21);
    setLevel('niva1');
    const seededIds = [...timesOf().keys()].slice(0, 2);
    assert.equal((await putSeeding([seededIds])).statusCode, 200);
    for (const firstStartMs of [at(10), at(11)]) {
      const res = await post({ mode: 'Seeded', firstStartMs, intervalSec: 60 });
      assert.equal(res.statusCode, 201, res.body);
      const lastTwo = [...timesOf().entries()]
        .sort((a, b) => a[1]! - b[1]!)
        .slice(3)
        .map(([id]) => id);
      assert.deepEqual(lastTwo.sort(), [...seededIds].sort());
    }
  });

  test('SOFT TR 7.4.5: seeding in elite classes at nivå 1 and in any class at a training, refused otherwise (422)', async () => {
    const body = { mode: 'Seeded', firstStartMs: at(10), intervalSec: 60 };
    assert.equal((await putSeeding([[...timesOf().keys()].slice(0, 2)])).statusCode, 200);
    const cases: Array<[CompetitionLevel, ClassKind, number]> = [
      ['niva1', 'elit', 201],
      ['niva1', 'senior', 422],
      ['niva2', 'elit', 422],
      ['niva3', 'elit', 422],
      ['niva4', 'senior', 201],
      ['traning', 'senior', 201],
    ];
    for (const [level, kind, status] of cases) {
      setLevel(level);
      setKind(kind, 21);
      const res = await post(body);
      assert.equal(res.statusCode, status, `${level} ${kind}: ${res.body}`);
      if (status === 422)
        assert.deepEqual(res.json(), { error: 'seeding_not_allowed', rule: 'SOFT TR 7.4.5' });
    }
    // A refusing rule needs a confirmed kind: a name suggestion is not enough.
    setLevel('niva1');
    ctx.handle.db
      .update(classes)
      .set({ classKind: 'elit', classKindSource: 'name' })
      .where(eq(classes.id, ctx.classId))
      .run();
    const guessed = await post(body);
    assert.equal(guessed.statusCode, 409, guessed.body);
    assert.equal((guessed.json() as { error: string }).error, 'class_kind_unconfirmed');
    setLevel(null);
    const unknown = await post(body);
    assert.equal(unknown.statusCode, 409);
    assert.equal((unknown.json() as { error: string }).error, 'competition_level_unknown');
  });

  test('Seeded: bad groups → 400; one group → 409', async () => {
    setKind('elit', 21);
    setLevel('niva1');
    assert.equal((await putSeeding([['nope']])).statusCode, 400);
    const id = [...timesOf().keys()][0]!;
    assert.equal((await putSeeding([[id], [id]])).statusCode, 400);
    assert.equal((await putSeeding([[...timesOf().keys()]])).statusCode, 200);
    const one = await post({ mode: 'Seeded', firstStartMs: at(10), intervalSec: 60 });
    assert.equal(one.statusCode, 409, one.body);
    assert.equal((one.json() as { error: string }).error, 'one_seeding_group');
  });
});
