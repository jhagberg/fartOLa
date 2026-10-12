// Authored for fartola. Not ported from upstream.
//
// node:test coverage for "Kontroll inför tävlingen":
// GET /api/competitions/:id/pre-race-check and classNeedsStartTimes.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, competitors, controls, courseControls, courses, events } from '../db/schema.ts';
import { classNeedsStartTimes, type PreRaceCheck } from '../projection/preRaceCheck.ts';

const COMP = 'comp-prc';
const hd = (ms: number) => ({
  seconds_in_half_day: Math.floor(ms / 1000) % 43200,
  half_day: ms >= 43_200_000 ? 1 : 0,
  weekday: null,
});

describe('classNeedsStartTimes', () => {
  const cls = (
    startMethod: 'auto' | 'start_time' | 'start_punch' | 'free_start',
    firstStartMs: number | null,
    classKind: 'senior' | 'oppen' | 'inskolning' | null,
    classKindSource: 'eventor' | 'name' | 'operator' | null = classKind && 'operator'
  ) => ({ startMethod, firstStartMs, classKind, classKindSource });

  test('age class at nivå 1-3 first, then start method, then a draw', () => {
    // Timed from the start punch (TR 4.18.16), but the order is drawn (TR 7.4.2).
    assert.equal(classNeedsStartTimes(cls('start_punch', null, 'senior'), 'niva1', false), true);
    // ADR-0018: a drawn answer with the punch needs start times too (was false).
    assert.equal(classNeedsStartTimes(cls('start_punch', 1, 'senior'), 'niva4', true), true);
    assert.equal(classNeedsStartTimes(cls('start_punch', 1, 'oppen'), 'niva1', true), false);
    assert.equal(
      classNeedsStartTimes(cls('start_punch', null, 'senior', 'name'), 'niva1', false),
      true
    );
    assert.equal(classNeedsStartTimes(cls('start_time', null, 'oppen'), null, false), true);
    assert.equal(classNeedsStartTimes(cls('auto', 1, 'oppen'), null, false), true);
    // An open class at nivå 2 takes only free start; the conflict list reports 'auto'.
    assert.equal(classNeedsStartTimes(cls('auto', null, 'oppen'), 'niva2', true), false);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'senior'), 'niva3', false), true);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'senior'), 'niva4', false), false);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'senior'), 'traning', false), false);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'oppen'), 'niva1', false), false);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'inskolning'), 'niva1', false), false);
    assert.equal(classNeedsStartTimes(cls('auto', null, null), 'niva1', false), false);
    // A kind only guessed from the name is not acted on.
    assert.equal(classNeedsStartTimes(cls('auto', null, 'senior', 'name'), 'niva1', false), false);
  });
});

describe('classNeedsStartTimes, the start choice (ADR-0018)', () => {
  const cls = (
    startMethod: 'auto' | 'start_time' | 'start_punch' | 'free_start',
    firstStartMs: number | null,
    classKind: 'senior' | 'oppen' | null
  ) => ({
    startMethod,
    firstStartMs,
    classKind,
    classKindSource: classKind && ('operator' as const),
  });

  test('start_punch needs start times when free start is not forbidden', () => {
    assert.equal(classNeedsStartTimes(cls('start_punch', null, null), 'niva4', false), true);
    assert.equal(classNeedsStartTimes(cls('start_punch', null, 'oppen'), 'niva4', false), true);
  });
  test('free_start never does, also with a runner drawn; an age class at nivå 2 still does', () => {
    assert.equal(classNeedsStartTimes(cls('free_start', null, null), null, true), false);
    assert.equal(classNeedsStartTimes(cls('free_start', 1, 'oppen'), 'niva4', true), false);
    assert.equal(classNeedsStartTimes(cls('free_start', null, 'senior'), 'niva2', false), true);
  });
  test('start_time in an open class: no at nivå 2, yes at nivå 4', () => {
    assert.equal(classNeedsStartTimes(cls('start_time', null, 'oppen'), 'niva2', false), false);
    assert.equal(classNeedsStartTimes(cls('start_time', null, 'oppen'), 'niva4', false), true);
  });
  test('auto: legacy rule', () => {
    assert.equal(classNeedsStartTimes(cls('auto', null, null), null, false), false);
    assert.equal(classNeedsStartTimes(cls('auto', 1, null), null, false), true);
    assert.equal(classNeedsStartTimes(cls('auto', null, null), null, true), true);
  });
});

describe('GET /api/competitions/:id/pre-race-check', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let nodeId: string;

  function runner(
    id: string,
    name: string,
    classId: string,
    card: number | null,
    club: string | null,
    startTimeMs: number | null = null
  ): void {
    handle.db
      .insert(competitors)
      .values({ id, competitionId: COMP, name, classId, cardNumber: card, club, startTimeMs })
      .run();
  }

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId, projectionDebounceMs: 0 });
    handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, level)
         VALUES (?, 'Prov', '2026-10-10', 'classic', 0, 0, 'niva2')`
      )
      .run(COMP);
    // H21: senior, drawn, 37 controls on its course (too many for an SI5).
    // H35: drawn, 31 controls (fits an SI5, splits after 30 missing).
    // Open: oppen, free start, course via the legacy courses.class_id.
    // D10: no course.
    handle.db
      .insert(classes)
      .values([
        { id: 'h21', competitionId: COMP, name: 'H21', classKind: 'senior', firstStartMs: 1 },
        { id: 'open', competitionId: COMP, name: 'Öppen 1', classKind: 'oppen' },
        {
          id: 'd10',
          competitionId: COMP,
          name: 'D10',
          classKind: 'ungdom',
          ageClass: 10,
          classKindSource: 'eventor',
        },
        // Timed from the start punch, then confirmed as an age class.
        {
          id: 'd16',
          competitionId: COMP,
          name: 'D16',
          classKind: 'ungdom',
          ageClass: 16,
          classKindSource: 'operator',
          startMethod: 'start_punch',
        },
        // The same, drawn and with a start time: nothing to fix.
        {
          id: 'd18',
          competitionId: COMP,
          name: 'D18',
          classKind: 'junior',
          ageClass: 18,
          classKindSource: 'operator',
          startMethod: 'start_punch',
          firstStartMs: 1,
        },
        // The same with a kind only guessed from the name: not flagged.
        {
          id: 'h16',
          competitionId: COMP,
          name: 'H16',
          classKind: 'ungdom',
          ageClass: 16,
          classKindSource: 'name',
          startMethod: 'start_punch',
        },
        { id: 'h35', competitionId: COMP, name: 'H35', classKind: 'veteran', firstStartMs: 1 },
      ])
      .run();
    handle.db
      .insert(courses)
      .values([
        { id: 'long', competitionId: COMP, name: 'Lång' },
        { id: 'short', competitionId: COMP, name: 'Kort', classId: 'open' },
        { id: 'mid', competitionId: COMP, name: 'Mellan', classId: 'h35' },
      ])
      .run();
    handle.sqlite.prepare(`UPDATE classes SET course_id = 'long' WHERE id = 'h21'`).run();
    for (let i = 0; i < 37; i++) {
      handle.db
        .insert(controls)
        .values({ id: `c${i}`, competitionId: COMP, code: 31 + i })
        .run();
      handle.db
        .insert(courseControls)
        .values({ id: `l${i}`, courseId: 'long', controlId: `c${i}`, orderIdx: i })
        .run();
      if (i < 31) {
        handle.db
          .insert(courseControls)
          .values({ id: `m${i}`, courseId: 'mid', controlId: `c${i}`, orderIdx: i })
          .run();
      }
    }
    handle.db
      .insert(courseControls)
      .values({ id: 's0', courseId: 'short', controlId: 'c0', orderIdx: 0 })
      .run();

    runner('ok', 'Anna Ok', 'h21', 8_000_001, 'OK Ek', 1_000);
    runner('si5', 'Bo Femma', 'h21', 12_345, 'OK Ek', 2_000);
    runner('nostart', 'Cia Utan', 'h21', 8_000_002, 'OK Ek');
    runner('nocard', 'Dan Utan', 'open', null, 'OK Ek');
    runner('noclub', 'Eva Klubblös', 'open', 12_346, null);
    runner('x', 'X', 'open', 8_000_003, 'OK Ek');
    runner('d10', 'Gun Liten', 'd10', 8_000_004, 'OK Ek');
    runner('si5mid', 'Ivar Femma', 'h35', 12_347, 'OK Ek', 3_000);
    runner('d16', 'Jill Punch', 'd16', 8_000_005, 'OK Ek');
    runner('d18', 'Lo Lottad', 'd18', 8_000_007, 'OK Ek', 4_000);
    runner('h16', 'Kim Punch', 'h16', 8_000_006, 'OK Ek');
    runner('gone', 'Hans Återbud', 'h21', null, null);
    handle.db
      .insert(events)
      .values({
        nodeId,
        localSeq: 1,
        competitionId: COMP,
        eventType: 'manual_status_set',
        eventTimeMs: 1,
        recordedAtMs: 1,
        payload: {
          event_type: 'manual_status_set',
          competitor_id: 'gone',
          status: 'CANCEL',
          reason: 'Återbud',
        },
      })
      .run();
  });
  afterEach(async () => {
    await app.close();
    handle.close();
  });

  test('lists each problem once, without withdrawn runners', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/competitions/${COMP}/pre-race-check`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as PreRaceCheck;
    const ids = (rows: Array<{ competitor_id: string }>) => rows.map((r) => r.competitor_id);
    assert.deepEqual(ids(body.no_card), ['nocard']);
    // H21 is drawn; D10 is an age class at nivå 2; D16 too, though timed
    // from the start punch; H16's kind is only guessed, but start_punch lists it
    // (ADR-0018); Öppen 1 has free start.
    assert.deepEqual(ids(body.no_start_time), ['nostart', 'd10', 'd16', 'h16']);
    // Nothing is drawn, nothing read, race not started: the shortcut is offered.
    assert.ok(
      body.no_start_time.every(
        (r) => r.free_start_offer === (r.class_id !== 'd10' && r.class_id !== 'd16')
      )
    );
    assert.deepEqual(ids(body.no_club), ['noclub']);
    assert.deepEqual(ids(body.no_name), ['x']);
    assert.deepEqual(
      body.card_too_small.map((r) => [r.competitor_id, r.class_name, r.capacity, r.controls]),
      [['si5', 'H21', 36, 37]]
    );
    assert.deepEqual(
      body.splits_missing.map((r) => [r.competitor_id, r.class_name, r.timed, r.controls]),
      [['si5mid', 'H35', 30, 31]]
    );
    assert.deepEqual(
      body.classes_without_course.map((c) => c.class_id),
      ['d10', 'd16', 'd18', 'h16']
    );
  });

  test('SOFT TA till TR 6.5.1 / TR 7.5.3: classes on one course starting the same minute are listed, the same first control as a warning', async () => {
    // H40 runs H21's course; H35's course shares only the first control.
    // Every start is in the first minute (02:00 on the clock, UTC+2).
    handle.db
      .insert(classes)
      .values({ id: 'h40', competitionId: COMP, name: 'H40', classKind: 'veteran' })
      .run();
    handle.sqlite.prepare(`UPDATE classes SET course_id = 'long' WHERE id = 'h40'`).run();
    runner('h40', 'Ola Fyrtio', 'h40', 8_000_008, 'OK Ek', 30_000);
    const res = await app.inject({
      method: 'GET',
      url: `/api/competitions/${COMP}/pre-race-check`,
    });
    const body = res.json() as PreRaceCheck;
    const pairs = (list: PreRaceCheck['start_clashes']) =>
      list.map((c) => [c.class_name, c.other_class_name, c.minutes]);
    assert.deepEqual(pairs(body.start_clashes), [['H21', 'H40', ['02:00']]]);
    assert.deepEqual(pairs(body.first_control_clashes), [
      ['H21', 'H35', ['02:00']],
      ['H35', 'H40', ['02:00']],
    ]);
  });

  test('404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/pre-race-check' });
    assert.equal(res.statusCode, 404);
  });
});

describe('start choice conflicts and the shortcut (ADR-0018)', () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let nodeId: string;
  let seq = 0;

  const check = async () =>
    (
      await app.inject({ method: 'GET', url: `/api/competitions/${COMP}/pre-race-check` })
    ).json() as PreRaceCheck;
  const cls = (id: string, extra: Partial<typeof classes.$inferInsert>) =>
    handle.db
      .insert(classes)
      .values({ id, competitionId: COMP, name: id, ...extra })
      .run();
  const runner = (id: string, classId: string, startTimeMs: number | null = null) =>
    handle.db
      .insert(competitors)
      .values({
        id,
        competitionId: COMP,
        name: `Runner ${id}`,
        classId,
        cardNumber: 100 + ++seq,
        club: 'OK',
        startTimeMs,
      })
      .run();
  const setLevel = (level: string) =>
    handle.sqlite.prepare(`UPDATE competitions SET level = ? WHERE id = ?`).run(level, COMP);
  const ev = (eventType: string, payload: Record<string, unknown>) =>
    handle.db
      .insert(events)
      .values({
        nodeId,
        localSeq: ++seq,
        competitionId: COMP,
        eventType,
        eventTimeMs: seq,
        recordedAtMs: seq,
        payload: { event_type: eventType, ...payload },
      } as typeof events.$inferInsert)
      .run();
  const read = (card: number, startAtMs: number | null = null) =>
    ev('card_read', {
      card_number: card,
      card_type: 'SI10',
      start: startAtMs === null ? null : hd(startAtMs),
      finish: startAtMs === null ? null : hd(startAtMs + 600_000),
      check: null,
      clear: null,
      punch_count: 0,
      punches: [],
      card_holder: null,
    });
  const patch = (classId: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/api/competitions/${COMP}/classes/${classId}`, payload });
  const stored = (classId: string) =>
    handle.db
      .select()
      .from(classes)
      .all()
      .find((c) => c.id === classId)?.startMethod;

  beforeEach(async () => {
    handle = openDatabase(':memory:');
    nodeId = ensureNodeId(handle);
    app = await buildServer({ logger: false, dbHandle: handle, nodeId, projectionDebounceMs: 0 });
    handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms, level)
         VALUES (?, 'Prov', '2026-10-10', 'classic', 0, 0, 'traning')`
      )
      .run(COMP);
  });
  afterEach(async () => {
    await app.close();
    handle.close();
  });

  test('free start stored, kind then confirmed as an age class at nivå 2: a conflict also when every runner has a time', async () => {
    cls('a', { startMethod: 'free_start', classKind: 'senior', classKindSource: 'operator' });
    runner('r1', 'a', 1000);
    assert.deepEqual((await check()).start_choice_conflicts, []); // träning
    setLevel('niva2');
    const body = await check();
    assert.deepEqual(body.start_choice_conflicts, [
      {
        class_id: 'a',
        class_name: 'a',
        runners: 1,
        reason: 'free_start_forbidden',
        free_start_offer: false,
      },
    ]);
    assert.equal(stored('a'), 'free_start', 'nothing stored is changed');
    setLevel('niva4');
    assert.deepEqual((await check()).start_choice_conflicts, []);
  });

  test('a drawn answer or legacy auto in an open class at nivå 2 is a conflict; at nivå 4 it is not', async () => {
    setLevel('niva2');
    cls('o1', { startMethod: 'start_time', classKind: 'oppen', classKindSource: 'operator' });
    cls('o2', { startMethod: 'auto', classKind: 'inskolning', classKindSource: 'eventor' });
    cls('o3', { startMethod: 'free_start', classKind: 'oppen', classKindSource: 'operator' });
    cls('o4', { startMethod: 'auto', classKind: 'oppen', classKindSource: 'name' }); // only guessed
    cls('age', { startMethod: 'auto', classKind: 'senior', classKindSource: 'operator' });
    runner('a', 'o1', 1000);
    runner('b', 'o2', 1000);
    runner('c', 'o2');
    runner('d', 'o3');
    runner('e', 'o4');
    runner('f', 'age');
    const body = await check();
    assert.deepEqual(
      body.start_choice_conflicts.map((c) => [c.class_id, c.runners, c.reason, c.free_start_offer]),
      [
        ['o1', 1, 'free_start_required', true],
        ['o2', 2, 'free_start_required', true],
      ]
    );
    assert.deepEqual(
      body.no_start_time.map((r) => r.competitor_id),
      ['f']
    );
    setLevel('niva4');
    assert.deepEqual((await check()).start_choice_conflicts, []);
  });

  test('PATCH guards: free start refused for a confirmed age class, a drawn answer for a confirmed open class, only at nivå 1-3', async () => {
    cls('age', { classKind: 'senior', classKindSource: 'operator' });
    cls('guess', { classKind: 'senior', classKindSource: 'name' });
    cls('open', { classKind: 'oppen', classKindSource: 'operator' });
    cls('insk', { classKind: 'inskolning', classKindSource: 'eventor' });
    setLevel('niva2');
    let res = await patch('age', { start_method: 'free_start' });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'free_start_forbidden' });
    assert.equal(stored('age'), 'auto');
    assert.equal((await patch('guess', { start_method: 'free_start' })).statusCode, 200);
    for (const id of ['open', 'insk'])
      for (const m of ['start_time', 'start_punch']) {
        res = await patch(id, { start_method: m });
        assert.equal(res.statusCode, 409);
        assert.deepEqual(res.json(), { error: 'free_start_required' });
        assert.equal(stored(id), 'auto');
      }
    assert.equal((await patch('open', { start_method: 'free_start' })).statusCode, 200);
    for (const level of ['niva4', 'traning']) {
      setLevel(level);
      assert.equal((await patch('age', { start_method: 'free_start' })).statusCode, 200);
      assert.equal((await patch('insk', { start_method: 'start_time' })).statusCode, 200);
    }
    handle.sqlite.prepare(`UPDATE competitions SET level = NULL WHERE id = ?`).run(COMP);
    assert.equal((await patch('open', { start_method: 'start_punch' })).statusCode, 200);
  });

  test('only_if_offered: not started and no reads → stored; race started → class_has_results', async () => {
    cls('o', { classKind: 'oppen', classKindSource: 'operator', startMethod: 'start_time' });
    runner('r', 'o');
    assert.equal(
      (await patch('o', { start_method: 'free_start', only_if_offered: true })).statusCode,
      200
    );
    assert.equal(stored('o'), 'free_start');
    handle.db.update(classes).set({ startMethod: 'start_time' }).run();
    handle.sqlite.prepare(`UPDATE competitions SET race_started_at_ms = 5 WHERE id = ?`).run(COMP);
    const res = await patch('o', { start_method: 'free_start', only_if_offered: true });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'class_has_results' });
    assert.equal(stored('o'), 'start_time');
    // Without the flag the ordinary setting still works.
    assert.equal((await patch('o', { start_method: 'free_start' })).statusCode, 200);
  });

  test('a started and reset race keeps reads and hand-set statuses: not offered, refused, times unchanged', async () => {
    setLevel('niva2');
    cls('o', { classKind: 'oppen', classKindSource: 'operator', startMethod: 'start_time' });
    runner('r1', 'o', 1_000_000);
    runner('r2', 'o');
    runner('r3', 'o');
    const startOf = () =>
      JSON.stringify(
        [...app.projectionStore.recomputeNow(COMP)!.competitors.values()].map((v) => [
          v.id,
          v.start_time_ms,
          v.status,
          v.late_start_ms,
        ])
      );
    const row = handle.db
      .select()
      .from(competitors)
      .all()
      .find((c) => c.id === 'r1')!;
    handle.sqlite.prepare(`UPDATE competitions SET race_started_at_ms = 5 WHERE id = ?`).run(COMP);
    // The drawn time is 1 000 s; the start punch comes 3 min later.
    read(row.cardNumber!, 1_180_000);
    ev('manual_status_set', { competitor_id: 'r2', status: 'DNF', reason: 'hand' });
    handle.sqlite
      .prepare(`UPDATE competitions SET race_started_at_ms = NULL WHERE id = ?`)
      .run(COMP);
    const before = startOf();
    const body = await check();
    assert.deepEqual(
      body.start_choice_conflicts.map((c) => [c.class_id, c.free_start_offer]),
      [['o', false]]
    );
    const res = await patch('o', { start_method: 'free_start', only_if_offered: true });
    assert.equal(res.statusCode, 409);
    assert.equal(stored('o'), 'start_time');
    assert.equal(startOf(), before);
  });

  test('an identity scan before the start: not offered', async () => {
    cls('o', { classKind: 'oppen', classKindSource: 'operator', startMethod: 'start_time' });
    runner('r1', 'o');
    const card = handle.db.select().from(competitors).get()!.cardNumber!;
    read(card);
    const res = await patch('o', { start_method: 'free_start', only_if_offered: true });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'class_has_results' });
  });
});
