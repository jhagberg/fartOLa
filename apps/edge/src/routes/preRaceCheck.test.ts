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

describe('classNeedsStartTimes', () => {
  const cls = (
    startMethod: 'auto' | 'start_time' | 'start_punch',
    firstStartMs: number | null,
    classKind: 'senior' | 'oppen' | 'inskolning' | null,
    classKindSource: 'eventor' | 'name' | 'operator' | null = classKind && 'operator'
  ) => ({ startMethod, firstStartMs, classKind, classKindSource });

  test('start method decides first, then a draw, then age class at nivå 1-3', () => {
    assert.equal(classNeedsStartTimes(cls('start_punch', 1, 'senior'), 'niva1', true), false);
    assert.equal(classNeedsStartTimes(cls('start_time', null, 'oppen'), null, false), true);
    assert.equal(classNeedsStartTimes(cls('auto', 1, 'oppen'), null, false), true);
    assert.equal(classNeedsStartTimes(cls('auto', null, 'oppen'), 'niva2', true), true);
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
        // The same but drawn: start punching is allowed (TR 4.18.16).
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
    // H21 is drawn; D10 is an age class at nivå 2; Öppen 1 has free start.
    assert.deepEqual(ids(body.no_start_time), ['nostart', 'd10']);
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
    assert.deepEqual(body.start_punch_not_allowed, [
      { class_id: 'd16', class_name: 'D16', runners: 1 },
    ]);
  });

  test('404 for an unknown competition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/competitions/nope/pre-race-check' });
    assert.equal(res.statusCode, 404);
  });
});
