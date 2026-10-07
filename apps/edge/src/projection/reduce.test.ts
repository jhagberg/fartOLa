// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the pure reducer. The 13 LOCKED scenarios from
// plan 01-07 task 2 verify gate. Tests 11–13 are the explicit codex C-H2
// regression gates at the reducer layer (finish=null → DNF; elapsed from
// HalfDayClock pair; history preserves the clocks).
//
// Strategy: pure-function tests — no DB. Each test constructs Event rows
// inline matching the Drizzle InferSelectModel shape, calls reduce(), and
// asserts on the returned CompetitionState.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { HalfDayClock, NdjsonPunch } from '@fartola/sportident';
import type { Event, Competitor, Class } from '../db/types.ts';
import type { EventPayload } from '../db/schema.ts';
import { reduce, type CourseWithControlCodes } from './reduce.ts';
import type { StartMethod } from './dnfMp.ts';
import type { CompetitorView } from './types.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function hd(totalSeconds: number): HalfDayClock {
  const wrapped = ((totalSeconds % (24 * 3600)) + 24 * 3600) % (24 * 3600);
  return {
    seconds_in_half_day: wrapped % (12 * 3600),
    half_day: wrapped < 12 * 3600 ? 0 : 1,
    weekday: null,
  };
}

function p(code: number): NdjsonPunch {
  return { code, seconds_in_half_day: 0, half_day: 0, weekday: null };
}

let seqCounter = 0;

function evt(
  payload: EventPayload,
  overrides: Partial<{
    competitionId: string;
    eventTimeMs: number;
    localSeq: number;
    nodeId: string;
  }> = {}
): Event {
  seqCounter += 1;
  return {
    nodeId: overrides.nodeId ?? 'node-A',
    localSeq: overrides.localSeq ?? seqCounter,
    competitionId: overrides.competitionId ?? 'comp-1',
    eventType: payload.event_type,
    eventTimeMs: overrides.eventTimeMs ?? 1_700_000_000_000 + seqCounter,
    recordedAtMs: 1_700_000_000_000 + seqCounter,
    payload,
  } as Event;
}

function cardRead(
  cardNumber: number,
  punches: NdjsonPunch[],
  start: HalfDayClock | null,
  finish: HalfDayClock | null,
  overrides: Partial<{
    competitionId: string;
    eventTimeMs: number;
    localSeq: number;
  }> = {}
): Event {
  return evt(
    {
      event_type: 'card_read',
      card_number: cardNumber,
      card_type: 'SI10',
      start,
      finish,
      check: null,
      clear: null,
      punch_count: punches.length,
      punches,
      card_holder: null,
    },
    overrides
  );
}

function comp(overrides: Partial<Competitor>): Competitor {
  return {
    id: 'c-1',
    competitionId: 'comp-1',
    name: 'Anna',
    club: null,
    classId: 'cls-H21',
    cardNumber: null,
    consentAtMs: null,
    consentStatus: 'explicit',
    scrubbedAtMs: null,
    source: 'walkup',
    startTimeMs: null,
    ...overrides,
  } as Competitor;
}

function cls(id: string, name = id): Class {
  return {
    id,
    competitionId: 'comp-1',
    name,
    shortName: null,
    firstStartMs: null,
    startIntervalSec: null,
    maxTimeSec: null,
  } as Class;
}

/** Class with a max_time_sec cap set. */
function clsWithMax(id: string, maxTimeSec: number, name = id): Class {
  return { ...cls(id, name), maxTimeSec };
}

function course(classId: string, controlCodes: readonly number[]): CourseWithControlCodes {
  return {
    id: `course-${classId}`,
    competitionId: 'comp-1',
    name: `Course ${classId}`,
    classId,
    lengthM: null,
    climbM: null,
    control_codes: controlCodes,
  } as CourseWithControlCodes;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('reduce — CompetitionState projection', () => {
  test('test 1: empty events + zero competitors → empty state', () => {
    const state = reduce({
      competition_id: 'comp-1',
      events: [],
      competitors: [],
      classes: [],
      courses: [],
    });
    assert.equal(state.competition_id, 'comp-1');
    assert.equal(state.competitors.size, 0);
    assert.equal(state.results_by_class.size, 0);
    assert.deepEqual(state.pending_unknown_cards, []);
    assert.equal(state.last_event_seq, 0);
  });

  test('test 2: single OK competitor — Anna SI10, 4-control course, full punches + finish', () => {
    seqCounter = 0;
    const events = [
      cardRead(7501853, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', name: 'Anna', cardNumber: 7501853 })],
      classes: [cls('cls-H21', 'H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.equal(anna.elapsed_time_ms, 600 * 1000);
    const h21Results = state.results_by_class.get('cls-H21');
    assert.ok(h21Results);
    assert.equal(h21Results.length, 1);
    assert.equal(h21Results[0]!.place, 1);
    assert.equal(h21Results[0]!.behind_leader_ms, 0);
  });

  test('test 3: walk-up flow — unknown card_number is queued; card_bound dismisses it', () => {
    seqCounter = 0;
    const events: Event[] = [
      cardRead(9_999_999, [], null, null),
      evt({
        event_type: 'card_bound',
        competitor_id: 'c-anna',
        card_number: 9_999_999,
        walkup: true,
        consent_at_ms: 1_700_000_000_500,
      }),
    ];
    // Snapshot after card_read but before card_bound — pending must contain 9999999.
    const afterRead = reduce({
      competition_id: 'comp-1',
      events: [events[0]!],
      competitors: [],
      classes: [],
      courses: [],
    });
    assert.deepEqual(afterRead.pending_unknown_cards, [9_999_999]);

    // Snapshot after BOTH events — pending must be empty.
    const afterBound = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [],
      classes: [],
      courses: [],
    });
    assert.deepEqual(afterBound.pending_unknown_cards, []);
  });

  test('test 4: mixed status — 3 competitors in same class, OK / MP / DNF sort order', () => {
    seqCounter = 0;
    const competitors = [
      comp({ id: 'c-anna', name: 'Anna', cardNumber: 1 }),
      comp({ id: 'c-bo', name: 'Bo', cardNumber: 2 }),
      comp({ id: 'c-cia', name: 'Cia', cardNumber: 3 }),
    ];
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)), // Anna OK
      cardRead(2, [p(31), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)), // Bo MP (missing 32)
      cardRead(3, [p(31), p(32)], hd(10 * 3600), null), // Cia DNF (no finish)
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors,
      classes: [cls('cls-H21', 'H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const rows = state.results_by_class.get('cls-H21');
    assert.ok(rows);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.status, 'OK');
    assert.equal(rows[0]!.name, 'Anna');
    assert.equal(rows[1]!.status, 'MP');
    assert.equal(rows[1]!.name, 'Bo');
    assert.equal(rows[2]!.status, 'DNF');
    assert.equal(rows[2]!.name, 'Cia');
  });

  test('test 5: manual_dnf overrides card_read OK', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({ event_type: 'manual_dnf', competitor_id: 'c-anna', reason: 'pulled rib muscle' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'DNF');
    assert.equal(anna.manual_dnf_reason, 'pulled rib muscle');
  });

  test('test 6: un_dnf reverts to the projected status', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({ event_type: 'manual_dnf', competitor_id: 'c-anna', reason: 'oops' }),
      evt({ event_type: 'un_dnf', competitor_id: 'c-anna' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.equal(anna.manual_dnf_reason, null);
    assert.equal(anna.elapsed_time_ms, 600 * 1000);
  });

  test('test 7: cross-competition isolation', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31)], hd(10 * 3600), hd(10 * 3600 + 100), { competitionId: 'comp-1' }),
      cardRead(2, [p(31)], hd(10 * 3600), hd(10 * 3600 + 100), { competitionId: 'comp-2' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [
        comp({ id: 'c-anna', competitionId: 'comp-1', cardNumber: 1 }),
        comp({ id: 'c-bo', competitionId: 'comp-2', cardNumber: 2 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31])],
    });
    // c-bo is in comp-2 → filtered out of competitorsByCompetition.
    assert.equal(state.competitors.size, 1);
    assert.ok(state.competitors.get('c-anna'));
  });

  test('test 8: latest card_read wins (two reads for same competitor)', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32)], hd(10 * 3600), hd(10 * 3600 + 500), { localSeq: 1 }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 800), {
        localSeq: 2,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK'); // latest read was complete
    assert.equal(anna.elapsed_time_ms, 800 * 1000);
    assert.equal(anna.card_read_history.length, 2);
  });

  test('test 9: places skip null-elapsed (DNF/MP do not consume place numbers)', () => {
    seqCounter = 0;
    const competitors = [
      comp({ id: 'c-anna', name: 'Anna', cardNumber: 1 }),
      comp({ id: 'c-bo', name: 'Bo', cardNumber: 2 }),
      comp({ id: 'c-cia', name: 'Cia', cardNumber: 3 }),
    ];
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500)), // Anna OK 500s
      cardRead(2, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)), // Bo OK 700s
      cardRead(3, [p(31), p(32)], hd(10 * 3600), null), // Cia DNF
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors,
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const rows = state.results_by_class.get('cls-H21');
    assert.ok(rows);
    assert.equal(rows[0]!.place, 1);
    assert.equal(rows[1]!.place, 2);
    assert.equal(rows[2]!.place, null); // Cia DNF has no place
  });

  test('test 10: behind_leader — 3 OK competitors get 0 / +200s / +400s', () => {
    seqCounter = 0;
    const competitors = [
      comp({ id: 'c-anna', name: 'Anna', cardNumber: 1 }),
      comp({ id: 'c-bo', name: 'Bo', cardNumber: 2 }),
      comp({ id: 'c-cia', name: 'Cia', cardNumber: 3 }),
    ];
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500)), // 500s
      cardRead(2, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)), // 700s
      cardRead(3, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 900)), // 900s
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors,
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const rows = state.results_by_class.get('cls-H21');
    assert.ok(rows);
    assert.deepEqual(
      rows.map((r) => r.behind_leader_ms),
      [0, 200_000, 400_000]
    );
    assert.deepEqual(
      rows.map((r) => r.place),
      [1, 2, 3]
    );
  });

  test('test 11 (C-H2 explicit reducer gate): finish=null → DNF regardless of full punch sequence', () => {
    // The Anna competitor has all 4 control punches in order, but the
    // card_read's payload.finish is null (operator killed the read
    // before the finish stamp). The reducer MUST emit DNF, not OK —
    // proving it reads payload.finish, not punches[] for magic codes.
    seqCounter = 0;
    const events = [cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), null)];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'DNF');
    assert.equal(anna.elapsed_time_ms, null);
    assert.equal(anna.latest_finish, null);
    assert.ok(anna.latest_start);
  });

  test('test 12 (C-H2 explicit reducer gate): elapsed computed from payload.start/finish pair', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 15 * 60)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.elapsed_time_ms, 15 * 60 * 1000);
  });

  test('test 13 (C-H2 explicit gate): card_read_history preserves start/finish clocks per read', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31)], hd(10 * 3600), hd(10 * 3600 + 100), { localSeq: 1 }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(11 * 3600), hd(11 * 3600 + 200), {
        localSeq: 2,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.card_read_history.length, 2);
    assert.notEqual(anna.card_read_history[0]!.finish, null);
    assert.notEqual(anna.card_read_history[1]!.finish, null);
    assert.deepEqual(anna.card_read_history[0]!.finish, hd(10 * 3600 + 100));
    assert.deepEqual(anna.card_read_history[1]!.finish, hd(11 * 3600 + 200));
    assert.deepEqual(anna.card_read_history[0]!.start, hd(10 * 3600));
    assert.deepEqual(anna.card_read_history[1]!.start, hd(11 * 3600));
  });

  // ---------------------------------------------------------------------------
  // Phase 2.0 — manual_status_set tests for the four new states added on
  // 2026-05-18. Each test asserts that:
  //   1. The override flips the status field as expected.
  //   2. view.manual_status carries the asserted code (not just 'DNF').
  //   3. view.manual_dnf_reason carries the operator reason (back-compat).
  //   4. A subsequent card_read does NOT overwrite the override (DQ only
  //      since 02.1-14 Task 12; the others are re-scored by a later read).
  //   5. clear_manual_status reverts to the auto-detected status.
  // ---------------------------------------------------------------------------

  for (const status of ['DNS', 'DQ', 'CANCEL', 'MAX'] as const) {
    test(`Phase-2.0 manual_status_set: ${status} wins over card_read`, () => {
      seqCounter = 0;
      const events = [
        cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
        evt({
          event_type: 'manual_status_set',
          competitor_id: 'c-anna',
          status,
          reason: `op-set-${status}`,
        }),
      ];
      const state = reduce({
        competition_id: 'comp-1',
        events,
        competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
        classes: [cls('cls-H21')],
        courses: [course('cls-H21', [31, 32, 33, 34])],
      });
      const anna = state.competitors.get('c-anna');
      assert.ok(anna);
      assert.equal(anna.status, status);
      assert.equal(anna.manual_status, status);
      assert.equal(anna.manual_dnf_reason, `op-set-${status}`);
    });
  }

  // A read-out after DNS/CANCEL proves the runner started, so it is scored
  // (MeOS oRunner.cpp evaluateCard: a stored DNS/CANCEL becomes the computed
  // status). Seen on Tuna Ting dag 2: marked DNS at the start check, read
  // out 35 minutes later, OK in the official result.
  for (const status of ['DNS', 'CANCEL'] as const) {
    test(`replay-readiness: a read-out after ${status} scores the run`, () => {
      seqCounter = 0;
      const events = [
        evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status, reason: 'start' }),
        cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      ];
      const state = reduce({
        competition_id: 'comp-1',
        events,
        competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
        classes: [cls('cls-H21')],
        courses: [course('cls-H21', [31, 32, 33, 34])],
      });
      const anna = state.competitors.get('c-anna');
      assert.ok(anna);
      assert.equal(anna.status, 'OK');
      assert.equal(anna.manual_status, null);
      assert.equal(anna.elapsed_time_ms, 600_000);
    });
  }

  // 02.1-14 Task 12: the same for every manual status except DQ (MeOS
  // evaluateCard, oRunner.cpp:1621-1630: DNS/CANCEL/MP/DNF become the card's
  // verdict; MAX only within max time). A status set AFTER the read wins.
  for (const status of ['DNF', 'MP', 'MAX'] as const) {
    test(`02.1-14 Task 12: ${status} by hand, then an OK read-out → OK`, () => {
      seqCounter = 0;
      const events = [
        evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status, reason: 'x' }),
        cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      ];
      const state = reduce({
        competition_id: 'comp-1',
        events,
        competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
        classes: [clsWithMax('cls-H21', 3600)],
        courses: [course('cls-H21', [31, 32, 33, 34])],
      });
      const anna = state.competitors.get('c-anna')!;
      assert.equal(anna.status, 'OK');
      assert.equal(anna.manual_status, null);
      assert.equal(anna.manual_dnf_reason, null);
      assert.equal(anna.elapsed_time_ms, 600_000);
      assert.equal(state.results_by_class.get('cls-H21')![0]!.place, 1);
    });
  }

  test('02.1-14 Task 12: legacy manual_dnf, then an OK read-out → OK', () => {
    seqCounter = 0;
    const events = [
      evt({ event_type: 'manual_dnf', competitor_id: 'c-anna', reason: 'x' }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    assert.equal(state.competitors.get('c-anna')?.status, 'OK');
  });

  test('02.1-14 Task 12: MAX by hand, then a read over the max time → MAX', () => {
    seqCounter = 0;
    const events = [
      evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'MAX', reason: 'x' }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 300)],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna')!;
    assert.equal(anna.status, 'MAX');
    // Re-derived from the class max time, not the hand-set status.
    assert.equal(anna.manual_status, null);
  });

  test('02.1-14 Task 12: DNF by hand, then a mispunched read-out → MP', () => {
    seqCounter = 0;
    const events = [
      evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'DNF', reason: 'x' }),
      cardRead(1, [p(31), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    assert.equal(state.competitors.get('c-anna')?.status, 'MP');
  });

  test('replay-readiness: a read-out after DQ keeps the DQ', () => {
    seqCounter = 0;
    const events = [
      evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'DQ', reason: 'x' }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    assert.equal(state.competitors.get('c-anna')?.status, 'DQ');
  });

  test('Phase-2.0 manual_status_set: DNS clears split fields (operator-asserted absence)', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'DNS',
        reason: 'no-show',
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'DNS');
    assert.equal(anna.elapsed_time_ms, null);
    assert.deepEqual(anna.missing_codes, []);
    assert.deepEqual(anna.extra_codes, []);
  });

  test('Phase-2.0 manual_status_set: MAX keeps the punch diff (attempted but over time)', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'MAX',
        reason: 'exceeded 2h cap',
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'MAX');
    // elapsed stays — runner did attempt the course; the operator's MAX
    // judgement is independent of whether they touched controls.
    assert.equal(anna.elapsed_time_ms, 600 * 1000);
  });

  test('Phase-2.1 DQ zeroes punch fields (contamination prevention)', () => {
    // Regression: before the fix, a DQ override left missing_codes /
    // extra_codes / latest_punches populated from the prior card_read.
    // After fix: DQ clears all punch analysis fields so the receipt/UI
    // does not show stale punch data for a disqualified runner.
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32)], hd(10 * 3600), null), // MP card_read
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'DQ',
        reason: 'rule-infringement',
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'DQ');
    assert.deepEqual(anna.missing_codes, [], 'DQ must zero missing_codes');
    assert.deepEqual(anna.extra_codes, [], 'DQ must zero extra_codes');
    assert.deepEqual(anna.out_of_order_codes, [], 'DQ must zero out_of_order_codes');
    assert.deepEqual(anna.latest_punches, [], 'DQ must zero latest_punches');
    assert.equal(anna.elapsed_time_ms, null, 'DQ must zero elapsed_time_ms');
  });

  test('Phase-2.0 clear_manual_status reverts to auto-detected status', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'DQ',
        reason: 'rule-break',
      }),
      evt({ event_type: 'clear_manual_status', competitor_id: 'c-anna' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.equal(anna.manual_status, null);
    assert.equal(anna.manual_dnf_reason, null);
    assert.equal(anna.elapsed_time_ms, 600 * 1000);
  });

  // ---------------------------------------------------------------------------
  // Phase 2.1 — race-phase gate (added 2026-05-18).
  //
  // The reducer's card_read arm now consults competition.race_started_at_ms
  // (threaded through ReduceInput). Three modes:
  //   - field omitted → gate disabled, score everything (back-compat for
  //                     the Phase-1 fixtures above which all assume scoring)
  //   - null          → pre-race phase, card_reads stay PEND
  //   - number        → race started; reads at/after score, reads before stay PEND
  //
  // Manual overrides win in all three modes (no race-phase weakening of the
  // operator's assertion semantics).
  // ---------------------------------------------------------------------------
  test('Phase-2.1 race-phase gate: pre-race (race_started_at_ms=null) → card_read stays PEND', () => {
    seqCounter = 0;
    const events = [cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600))];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: null,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'PEND');
    assert.equal(anna.elapsed_time_ms, null);
    // History is preserved for the audit trail even though scoring is off.
    assert.equal(anna.card_read_history.length, 1);
  });

  test('Phase-2.1 race-phase gate: clearing a manual status before the race leaves the identity scan PEND', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'DNF', reason: 'x' }),
      evt({ event_type: 'clear_manual_status', competitor_id: 'c-anna' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: null,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'PEND');
    assert.equal(anna.elapsed_time_ms, null);
    assert.deepEqual(state.results_by_class.get('cls-H21')?.[0]?.place, null);
  });

  test('Phase-2.1 race-phase gate: clearing a manual status after the start re-scores only an in-race read', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      // Desk scan before the start, then DNF set and cleared during the race.
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600), {
        eventTimeMs: raceStartMs - 60_000,
      }),
      evt(
        { event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'DNF', reason: 'x' },
        { eventTimeMs: raceStartMs + 60_000 }
      ),
      evt(
        { event_type: 'clear_manual_status', competitor_id: 'c-anna' },
        { eventTimeMs: raceStartMs + 120_000 }
      ),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: raceStartMs,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    assert.equal(state.competitors.get('c-anna')?.status, 'PEND');
  });

  test('Phase-2.1 race-phase gate: race-started, card_read AFTER stamp scores normally', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600), {
        eventTimeMs: raceStartMs + 60_000,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: raceStartMs,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.equal(anna.elapsed_time_ms, 600 * 1000);
  });

  test('Phase-2.1 race-phase gate: race-started, card_read BEFORE stamp stays PEND', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      // Card scanned at the registration desk an hour before race start —
      // the SIAC still has punches from a different race on it. Must not
      // contaminate today's results.
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600), {
        eventTimeMs: raceStartMs - 3_600_000,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: raceStartMs,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'PEND');
    assert.equal(anna.elapsed_time_ms, null);
  });

  test('Phase-2.1 race_started event mid-log flips the in-pass gate', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      // Pre-race scan: stale punches from another race. Stays PEND.
      cardRead(1, [p(31)], hd(10 * 3600), hd(10 * 3600 + 100), {
        eventTimeMs: raceStartMs - 60_000,
      }),
      // The race_started event flips the gate. The column would normally
      // be set in lockstep by the route; this asserts the reducer is
      // correct under pure replay when the column is empty.
      evt({ event_type: 'race_started', started_at_ms: raceStartMs }, { eventTimeMs: raceStartMs }),
      // Post-race scan: full clean run. Scores OK.
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(11 * 3600), hd(11 * 3600 + 500), {
        eventTimeMs: raceStartMs + 60_000,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: null,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.equal(anna.elapsed_time_ms, 500 * 1000);
    // Both reads land in history regardless of phase — audit trail
    // stays complete.
    assert.equal(anna.card_read_history.length, 2);
  });

  test('Phase-2.1 race_reset event un-scores prior reads (auto status only)', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      evt({ event_type: 'race_started', started_at_ms: raceStartMs }, { eventTimeMs: raceStartMs }),
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500), {
        eventTimeMs: raceStartMs + 60_000,
      }),
      evt(
        { event_type: 'race_reset', previous_started_at_ms: raceStartMs },
        { eventTimeMs: raceStartMs + 120_000 }
      ),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: null,
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'PEND');
    assert.equal(anna.elapsed_time_ms, null);
    assert.deepEqual(anna.missing_codes, []);
    assert.deepEqual(anna.extra_codes, []);
    // History stays — race_reset is a rollback of scoring, not a wipe.
    assert.equal(anna.card_read_history.length, 1);
  });

  test('Phase-2.1 race_reset preserves manual_status overrides', () => {
    seqCounter = 0;
    const raceStartMs = 1_700_000_000_000;
    const events = [
      evt({ event_type: 'race_started', started_at_ms: raceStartMs }, { eventTimeMs: raceStartMs }),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-bob',
        status: 'DNF',
        reason: 'injury',
      }),
      evt(
        { event_type: 'race_reset', previous_started_at_ms: raceStartMs },
        { eventTimeMs: raceStartMs + 120_000 }
      ),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      race_started_at_ms: null,
      events,
      competitors: [comp({ id: 'c-bob', cardNumber: 2 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const bob = state.competitors.get('c-bob');
    assert.ok(bob);
    assert.equal(bob.status, 'DNF');
    assert.equal(bob.manual_status, 'DNF');
  });

  test('Phase-2.0 results sort: OK > MP > DNF > DQ > MAX > DNS > CANCEL > PEND', () => {
    seqCounter = 0;
    const competitors = [
      comp({ id: 'c-ok', name: 'OK', cardNumber: 1 }),
      comp({ id: 'c-mp', name: 'MP', cardNumber: 2 }),
      comp({ id: 'c-dnf', name: 'DNF', cardNumber: 3 }),
      comp({ id: 'c-max', name: 'MAX', cardNumber: 4 }),
      comp({ id: 'c-dq', name: 'DQ', cardNumber: 5 }),
      comp({ id: 'c-dns', name: 'DNS', cardNumber: 6 }),
      comp({ id: 'c-cancel', name: 'CANCEL', cardNumber: 7 }),
      comp({ id: 'c-pend', name: 'PEND', cardNumber: 8 }),
    ];
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500)),
      cardRead(2, [p(31), p(33)], hd(10 * 3600), hd(10 * 3600 + 700)),
      cardRead(3, [p(31)], hd(10 * 3600), null),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-max',
        status: 'MAX',
        reason: 'over',
      }),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-dq',
        status: 'DQ',
        reason: 'dq',
      }),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-dns',
        status: 'DNS',
        reason: 'no-show',
      }),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-cancel',
        status: 'CANCEL',
        reason: 'wd',
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors,
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const rows = state.results_by_class.get('cls-H21');
    assert.ok(rows);
    assert.deepEqual(
      rows.map((r) => r.status),
      ['OK', 'MP', 'DNF', 'DQ', 'MAX', 'DNS', 'CANCEL', 'PEND']
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 2.1 — D-08/D-15/D-16 reducer extensions.
//
// Tests 1-12 below drive the RED phase for:
//   - MAX auto-compute from class.maxTimeSec (D-08)
//   - Voided legs (D-16): leg_voided / leg_unvoided events
//   - Replacement controls (D-15): alternative punched codes count as a match
//
// These tests MUST FAIL before the reducer extensions are applied.
// ---------------------------------------------------------------------------

describe('Phase-2.1 reducer extensions — MAX / voided legs / replacement controls', () => {
  // Test 1: OK with elapsed over cap → MAX
  test('test 1: MAX auto-compute — OK but elapsed/1000 > class.maxTimeSec → status is MAX', () => {
    seqCounter = 0;
    // Anna finishes OK (all controls + finish) in 700s. Class cap is 600s.
    const events = [cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700))];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'MAX');
    assert.equal(anna.elapsed_time_ms, 700 * 1000);
  });

  // Test 2: OK with elapsed within cap → status stays OK
  test('test 2: MAX auto-compute — elapsed within cap → status stays OK', () => {
    seqCounter = 0;
    // Anna finishes in 500s. Class cap is 600s. Should stay OK.
    const events = [cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500))];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
  });

  test('SOFT TR 4.21.1: the competition max time applies to every class, over any class value', () => {
    seqCounter = 0;
    // 700 s runs in two classes. Competition max time 600 s; H21 has no own
    // value, D21 has 900 s. The competition value wins in both.
    const read = (card: number, sec: number): Event =>
      cardRead(card, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + sec));
    const project = (maxTimeSec: number | null) =>
      reduce({
        competition_id: 'comp-1',
        max_time_sec: maxTimeSec,
        events: [read(1, 700), read(2, 700), read(3, 1000)],
        competitors: [
          comp({ id: 'c-anna', cardNumber: 1 }),
          comp({ id: 'c-bea', cardNumber: 2, classId: 'cls-D21' }),
          comp({ id: 'c-cia', cardNumber: 3, classId: 'cls-D21' }),
        ],
        classes: [cls('cls-H21'), clsWithMax('cls-D21', 900)],
        courses: [course('cls-H21', [31, 32, 33, 34]), course('cls-D21', [31, 32, 33, 34])],
      });
    const statuses = (maxTimeSec: number | null) => {
      const state = project(maxTimeSec);
      return ['c-anna', 'c-bea', 'c-cia'].map((id) => state.competitors.get(id)!.status);
    };
    assert.deepEqual(statuses(600), ['MAX', 'MAX', 'MAX'], 'one limit for every class');
    // Without a competition max time, a class value applies (non-sanctioned).
    assert.deepEqual(statuses(null), ['OK', 'OK', 'MAX']);
  });

  // Test 3: No cap → no MAX promotion
  test('test 3: MAX auto-compute — class.maxTimeSec is null → no MAX promotion', () => {
    seqCounter = 0;
    // cls() has maxTimeSec: null. Even 9999s should stay OK.
    const events = [cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 9999))];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
  });

  // Test 4: manual MAX + clear → auto-compute re-fires (MAX if over cap)
  test('test 4: clear_manual_status re-derives MAX from auto-compute when over cap', () => {
    seqCounter = 0;
    // Anna over cap. Operator sets MAX manually. Then clears it → should still be MAX.
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)),
      evt({ event_type: 'manual_status_set', competitor_id: 'c-anna', status: 'MAX', reason: 'x' }),
      evt({ event_type: 'clear_manual_status', competitor_id: 'c-anna' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'MAX');
    assert.equal(anna.manual_status, null);
  });

  // Test 5: manual DNS not overridden by MAX auto-compute
  test('test 5: manual DNS is NOT overridden by MAX auto-compute', () => {
    seqCounter = 0;
    // Card read arrives (over cap), but then DNS is set manually. DNS must win.
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'DNS',
        reason: 'no-show',
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'DNS');
  });

  // Test 6: leg_voided adds control_code to voided_legs
  test('test 6: leg_voided event adds control_code to view.voided_legs', () => {
    seqCounter = 0;
    const events = [
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 32,
        max_seconds: null,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: null })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.deepEqual(anna.voided_legs, [32]);
  });

  // Test 7: leg_unvoided removes control_code from voided_legs
  test('test 7: leg_unvoided removes control_code from view.voided_legs', () => {
    seqCounter = 0;
    const events = [
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 32,
        max_seconds: null,
      }),
      evt({ event_type: 'leg_unvoided', competitor_id: 'c-anna', control_code: 32 }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: null })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.deepEqual(anna.voided_legs, []);
  });

  // Test 8: replacement controls — code 32 replaces expected code 31 → OK
  test('test 8: replacement controls — punched code 32 replaces expected code 31 → OK', () => {
    seqCounter = 0;
    // Course expects [31, 32, 33, 34]. Anna punches [32, 32, 33, 34].
    // Wait, that doesn't make sense. The replacement maps expected 31 → allowed 32.
    // So when position expects 31, punching 32 counts as a match.
    // Anna punches [32, 32, 33, 34] but course expects [31, 32, 33, 34] —
    // at position 0 she punches 32 instead of 31, which is a valid replacement.
    const events = [cardRead(1, [p(32), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600))];
    // replacementControls: courseId → (expectedCode → [alternativeCodes])
    const replacementControls: ReadonlyMap<string, ReadonlyMap<number, number[]>> = new Map([
      ['course-cls-H21', new Map([[31, [32]]])],
    ]);
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
      replacementControls,
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
  });

  // Test 9: no replacement mapping for code 33 → MP
  test('test 9: replacement controls — no replacement for code 31 → 33 → status is MP', () => {
    seqCounter = 0;
    // Course expects [31, 32, 33, 34]. Anna punches [33, 32, 33, 34].
    // Only 31→32 replacement exists, not 31→33. So punching 33 at pos 0 is MP.
    const events = [cardRead(1, [p(33), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600))];
    const replacementControls: ReadonlyMap<string, ReadonlyMap<number, number[]>> = new Map([
      ['course-cls-H21', new Map([[31, [32]]])],
    ]);
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
      replacementControls,
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'MP');
  });

  // Test 10: cyclic mapping (31→32, 32→31) — no infinite loop, depth=1 only
  test('test 10: cyclic replacement mapping does not cause infinite loop (depth=1)', () => {
    seqCounter = 0;
    // Course expects [31, 32]. Anna punches [32, 31].
    // If we had chaining: 31→32→31→... — but we only do one level.
    // Expected 31, punched 32 → matches (31→32 replacement exists).
    // Expected 32, punched 31 → matches (32→31 replacement exists).
    // Result: OK.
    const events = [cardRead(1, [p(32), p(31)], hd(10 * 3600), hd(10 * 3600 + 300))];
    const replacementControls: ReadonlyMap<string, ReadonlyMap<number, number[]>> = new Map([
      [
        'course-cls-H21',
        new Map([
          [31, [32]],
          [32, [31]],
        ]),
      ],
    ]);
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
      replacementControls,
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
  });

  test('replacement control punched after a stray control still matches → OK', () => {
    seqCounter = 0;
    // Course [31, 32] with 31 → 131. Anna punches a stray 99 first, then 131
    // and 32: the replacement must be matched by the same advancing cursor as
    // ordinary controls, not by array position.
    const events = [cardRead(1, [p(99), p(131), p(32)], hd(10 * 3600), hd(10 * 3600 + 300))];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
      replacementControls: new Map([['course-cls-H21', new Map([[31, [131]]])]]),
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.deepEqual(anna.missing_codes, []);
    assert.deepEqual(anna.extra_codes, [99]);
  });

  test('replacement control punched out of order is missing → MP', () => {
    seqCounter = 0;
    // Course [31, 32] with 31 → 131; Anna punches 32 before 131.
    const events = [cardRead(1, [p(32), p(131)], hd(10 * 3600), hd(10 * 3600 + 300))];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
      replacementControls: new Map([['course-cls-H21', new Map([[31, [131]]])]]),
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'MP');
    assert.deepEqual(anna.missing_codes, [32]);
  });

  // Tests 11-12: a voided leg never changes the running time. SOFT TR
  // 4.20.10 (Regelverk för OL 2026-07-01): "Resultaten måste baseras på de
  // tävlandes tider för hela banan. Inga resultat får konstrueras eller
  // rekonstrueras baserat på sträcktiderna." Until 2026-10-05 the reducer
  // subtracted the voided leg (capped by max_seconds); these two tests locked
  // that and now lock the opposite. leg_voided only means "this control is
  // not required for this runner".
  test('test 11: voided leg — running time is the whole course, not reduced (TR 4.20.10)', () => {
    seqCounter = 0;
    // 31 at +60 s, 32 at +120 s (60 s leg), finish at +300 s. Voiding 32
    // leaves the time at 300 s.
    const baseMs = 10 * 3600; // 10:00:00 in seconds
    const events = [
      cardRead(
        1,
        [
          { code: 31, seconds_in_half_day: baseMs + 60, half_day: 0, weekday: null },
          { code: 32, seconds_in_half_day: baseMs + 120, half_day: 0, weekday: null },
          { code: 33, seconds_in_half_day: baseMs + 180, half_day: 0, weekday: null },
          { code: 34, seconds_in_half_day: baseMs + 240, half_day: 0, weekday: null },
        ],
        hd(baseMs),
        hd(baseMs + 300)
      ),
      evt({ event_type: 'leg_voided', competitor_id: 'c-anna', control_code: 32 }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.deepEqual(anna.voided_legs, [32]);
    assert.equal(anna.elapsed_time_ms, 300 * 1000);
  });

  test('test 12: an old leg_voided event with max_seconds replays; the cap is ignored', () => {
    seqCounter = 0;
    // Event logs from before 2026-10-05 may carry max_seconds. They must
    // still replay: the control stays voided, the time stays whole.
    const baseMs = 10 * 3600;
    const events = [
      cardRead(
        1,
        [
          { code: 31, seconds_in_half_day: baseMs + 60, half_day: 0, weekday: null },
          { code: 32, seconds_in_half_day: baseMs + 150, half_day: 0, weekday: null }, // 90s leg
          { code: 33, seconds_in_half_day: baseMs + 200, half_day: 0, weekday: null },
          { code: 34, seconds_in_half_day: baseMs + 250, half_day: 0, weekday: null },
        ],
        hd(baseMs),
        hd(baseMs + 300)
      ),
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 32,
        max_seconds: 60,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.deepEqual(anna.voided_legs, [32]);
    assert.equal(anna.elapsed_time_ms, 300 * 1000);
  });

  test('voided leg does not bring a runner over max time back under it (TR 4.20.10)', () => {
    seqCounter = 0;
    // 700 s run, class max 600 s, the 31 → 32 leg is 400 s. Subtracting it
    // used to turn MAX into OK; the time is now the whole course.
    const t = 10 * 3600;
    const events = [
      cardRead(
        1,
        [
          { code: 31, seconds_in_half_day: t + 100, half_day: 0, weekday: null },
          { code: 32, seconds_in_half_day: t + 500, half_day: 0, weekday: null },
        ],
        hd(t),
        hd(t + 700)
      ),
      evt({ event_type: 'leg_voided', competitor_id: 'c-anna', control_code: 32 }),
    ];
    const anna = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32])],
    }).competitors.get('c-anna')!;
    assert.equal(anna.status, 'MAX');
    assert.equal(anna.elapsed_time_ms, 700 * 1000);
  });

  // Test 13: voided leg — competitor misses voided control → OK, not MP
  test('test 13: voided leg — missing voided control yields OK not MP', () => {
    seqCounter = 0;
    // Course expects [31, 32, 33, 34]. Anna only punches [31, 33, 34] — misses 32.
    // Control 32 is voided → she should be OK (voided control removed from expected).
    const baseMs = 10 * 3600;
    const events = [
      cardRead(
        1,
        [
          { code: 31, seconds_in_half_day: baseMs + 60, half_day: 0, weekday: null },
          { code: 33, seconds_in_half_day: baseMs + 180, half_day: 0, weekday: null },
          { code: 34, seconds_in_half_day: baseMs + 240, half_day: 0, weekday: null },
        ],
        hd(baseMs),
        hd(baseMs + 300)
      ),
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 32,
        max_seconds: null,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK', 'voided control should not cause MP');
    assert.deepEqual(anna.missing_codes, []);
  });

  test('voiding the missing control of a runner without a start → OK, missing start flagged', () => {
    seqCounter = 0;
    // Course [31, 32]; finish and 32 punched, 31 missing, no start punch and
    // no drawn start (no running time). Voiding 31 must still clear the MP.
    const t = 10 * 3600;
    const events = [
      cardRead(
        1,
        [{ code: 32, seconds_in_half_day: t + 600, half_day: 0, weekday: null }],
        null,
        hd(t + 1200)
      ),
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 31,
        max_seconds: null,
      }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK');
    assert.deepEqual(anna.missing_codes, []);
    assert.equal(anna.elapsed_time_ms, null);
    assert.equal(anna.missing_start, true);
  });

  // Codex third review of #51, finding 2: the post-pass skipped runners whose
  // final waiver list is empty, so a read scored while 31 was waived kept OK.
  test('void 31 → read missing 31 → unvoid 31 → MP again', () => {
    seqCounter = 0;
    const t = 10 * 3600;
    const events = [
      evt({ event_type: 'leg_voided', competitor_id: 'c-anna', control_code: 31 }),
      cardRead(
        1,
        [{ code: 32, seconds_in_half_day: t + 600, half_day: 0, weekday: null }],
        hd(t),
        hd(t + 1200)
      ),
      evt({ event_type: 'leg_unvoided', competitor_id: 'c-anna', control_code: 31 }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
    });
    const anna = state.competitors.get('c-anna')!;
    assert.deepEqual(anna.voided_legs, []);
    assert.equal(anna.status, 'MP');
    assert.deepEqual(anna.missing_codes, [31]);
    assert.equal(anna.elapsed_time_ms, 1200 * 1000);
  });

  // Test 14: clear_manual_status with voided leg — re-derive should filter voided
  test('test 14: clear_manual_status with voided leg re-derives correctly', () => {
    seqCounter = 0;
    const baseMs = 10 * 3600;
    const events = [
      cardRead(1, [p(31), p(33), p(34)], hd(baseMs), hd(baseMs + 300)),
      evt({
        event_type: 'leg_voided',
        competitor_id: 'c-anna',
        control_code: 32,
        max_seconds: null,
      }),
      evt({
        event_type: 'manual_status_set',
        competitor_id: 'c-anna',
        status: 'DQ',
        reason: 'test',
      }),
      evt({ event_type: 'clear_manual_status', competitor_id: 'c-anna' }),
    ];
    const state = reduce({
      competition_id: 'comp-1',
      events,
      competitors: [comp({ id: 'c-anna', cardNumber: 1 })],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    });
    const anna = state.competitors.get('c-anna');
    assert.ok(anna);
    assert.equal(anna.status, 'OK', 'after clearing DQ with voided leg, should be OK not MP');
  });
});

// 02.1-14 Task 3: the reducer passes the drawn start and the read time.
// Task 11 made the start punch win (MeOS, 44 min); Task 14 follows SOFT TR
// 4.18.9 (2026-07-01) again: in the default 'auto' method the start time
// wins (45 min), as this test first expected.
describe('reduce — elapsed from drawn start (02.1-14 Task 3)', () => {
  const at = (sec: number): number => localToEpochMs('2026-10-03', sec);

  test('drawn 10:00, start punch 10:01, finish 10:45 → 45 min; open start → 44 min', () => {
    seqCounter = 0;
    const punches = [p(31), p(32)];
    const read = (card: number): Event =>
      cardRead(card, punches, hd(10 * 3600 + 60), hd(10 * 3600 + 45 * 60), {
        eventTimeMs: at(10 * 3600 + 50 * 60),
      });
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(101), read(102)],
      competitors: [
        comp({ id: 'drawn', cardNumber: 101, startTimeMs: at(10 * 3600) }),
        comp({ id: 'open', cardNumber: 102 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
    });
    assert.equal(state.competitors.get('drawn')!.elapsed_time_ms, 45 * 60 * 1000);
    assert.equal(state.competitors.get('open')!.elapsed_time_ms, 44 * 60 * 1000);
  });
});

// 02.1-14 Task 14 (replaces Task 11's ignoreStartPunch): the class's start
// method decides the start. 'auto' = the start time when the runner has one
// (SOFT TR 4.18.9 (2026-07-01): ursprunglig starttid gäller), else the punch.
describe('reduce — start method per class (02.1-14 Task 14)', () => {
  const at = (sec: number): number => localToEpochMs('2026-10-03', sec);
  const START = 10 * 3600 + 22 * 60;
  // DM dag 1, D10: moved to 10:22:00, punched start 10:22:06.
  const read = (card: number, punches: NdjsonPunch[] = [p(31)], startSec = START + 6): Event =>
    cardRead(card, punches, hd(startSec), hd(10 * 3600 + 52 * 60), {
      eventTimeMs: at(10 * 3600 + 55 * 60),
    });
  const drawn = at(START);
  const withMethod = (startMethod: StartMethod): Class => ({ ...cls('cls-H21'), startMethod });

  test('auto: start time 10:22:00 + punch 10:22:06 → timed from 10:22:00 (SOFT TR 4.18.9 (2026-07-01))', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(101), read(102)],
      competitors: [
        comp({ id: 'a', cardNumber: 101, startTimeMs: drawn }),
        // No start time (open class): the punch is the only start there is.
        comp({ id: 'open', cardNumber: 102 }),
      ],
      classes: [withMethod('auto')],
      courses: [course('cls-H21', [31])],
    });
    assert.equal(state.competitors.get('a')!.elapsed_time_ms, 30 * 60 * 1000);
    assert.equal(state.competitors.get('open')!.elapsed_time_ms, (30 * 60 - 6) * 1000);
  });

  test('start_punch (MeOS): timed from the punch 10:22:06', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(101)],
      competitors: [comp({ id: 'a', cardNumber: 101, startTimeMs: drawn })],
      classes: [withMethod('start_punch')],
      courses: [course('cls-H21', [31])],
    });
    assert.equal(state.competitors.get('a')!.elapsed_time_ms, (30 * 60 - 6) * 1000);
  });

  test('start_time without a start time: punch ignored → missing start, no time', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(101)],
      competitors: [comp({ id: 'a', cardNumber: 101 })],
      classes: [withMethod('start_time')],
      courses: [course('cls-H21', [31])],
    });
    const a = state.competitors.get('a')!;
    assert.equal(a.status, 'OK');
    assert.equal(a.elapsed_time_ms, null);
    assert.equal(a.missing_start, true);
  });

  // A late or early start punch in a class timed from the start time is a
  // warning for the jury, not a time change (SOFT TR 4.18.9 (2026-07-01),
  // TA "Sen start"; TR 4.18.16 (2026-07-01) start punching).
  const warnings = (method: StartMethod, startSec: number, startTimeMs: number | null = drawn) => {
    seqCounter = 0;
    const a = reduce({
      competition_id: 'comp-1',
      events: [read(101, [p(31)], startSec)],
      competitors: [comp({ id: 'a', cardNumber: 101, startTimeMs })],
      classes: [withMethod(method)],
      courses: [course('cls-H21', [31])],
    }).competitors.get('a')!;
    return { late: a.late_start_ms, early: a.early_start_ms };
  };

  test('late start: punch more than 60 s after the start time → late_start_ms', () => {
    assert.deepEqual(warnings('auto', START + 60), { late: null, early: null });
    assert.deepEqual(warnings('auto', START + 61), { late: 61_000, early: null });
    assert.deepEqual(warnings('start_time', START + 192), { late: 192_000, early: null });
  });

  test('early start: punch before the start time → early_start_ms', () => {
    assert.deepEqual(warnings('auto', START), { late: null, early: null });
    assert.deepEqual(warnings('auto', START - 1), { late: null, early: 1_000 });
    assert.deepEqual(warnings('start_time', START - 5), { late: null, early: 5_000 });
  });

  test('no warnings when timed from the punch (start_punch, or no start time)', () => {
    assert.deepEqual(warnings('start_punch', START + 192), { late: null, early: null });
    assert.deepEqual(warnings('start_punch', START - 5), { late: null, early: null });
    assert.deepEqual(warnings('auto', START + 192, null), { late: null, early: null });
  });
});

// 02.1-14 Task 4: classes point at courses; many classes per course.
describe('reduce — course by class.courseId (02.1-14 Task 4)', () => {
  test('two classes share one course (course.classId unset) → both scored against it', () => {
    seqCounter = 0;
    const shared = { ...course('unused', [31, 32]), id: 'course-shared', classId: null };
    const run = (card: number, punches: NdjsonPunch[]): Event =>
      cardRead(card, punches, hd(10 * 3600), hd(10 * 3600 + 600));
    const state = reduce({
      competition_id: 'comp-1',
      events: [run(101, [p(31), p(32)]), run(102, [p(31), p(32)]), run(103, [p(31)])],
      competitors: [
        comp({ id: 'h', classId: 'cls-H21', cardNumber: 101 }),
        comp({ id: 'd', classId: 'cls-D21', cardNumber: 102 }),
        comp({ id: 'd-mp', classId: 'cls-D21', cardNumber: 103 }),
      ],
      classes: [
        { ...cls('cls-H21'), courseId: 'course-shared' },
        { ...cls('cls-D21'), courseId: 'course-shared' },
      ],
      courses: [shared],
    });
    assert.equal(state.competitors.get('h')!.status, 'OK');
    assert.equal(state.competitors.get('d')!.status, 'OK');
    assert.equal(state.competitors.get('d-mp')!.status, 'MP');
    assert.deepEqual(state.competitors.get('d-mp')!.missing_codes, [32]);
  });

  test('class.courseId wins over a legacy course.classId pointer', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [cardRead(101, [p(41)], hd(10 * 3600), hd(10 * 3600 + 600))],
      competitors: [comp({ id: 'h', classId: 'cls-H21', cardNumber: 101 })],
      classes: [{ ...cls('cls-H21'), courseId: 'course-new' }],
      courses: [
        course('cls-H21', [31]),
        { ...course('cls-H21', [41]), id: 'course-new', classId: null },
      ],
    });
    assert.equal(state.competitors.get('h')!.status, 'OK');
  });
});

// 02.1-14 Task 5: a control voided for the whole competition drops out of
// every course's expected list.
describe('reduce — course-wide voided control (02.1-14 Task 5)', () => {
  const run = (card: number, punches: NdjsonPunch[]): Event =>
    cardRead(card, punches, hd(10 * 3600), hd(10 * 3600 + 600));
  const voided = (code: number): Event => evt({ event_type: 'control_voided', control_code: code });
  const unvoided = (code: number): Event =>
    evt({ event_type: 'control_unvoided', control_code: code });
  const project = (events: Event[]) =>
    reduce({
      competition_id: 'comp-1',
      events,
      competitors: [
        comp({ id: 'missed', classId: 'cls-H21', cardNumber: 101 }),
        comp({ id: 'punched', classId: 'cls-H21', cardNumber: 102 }),
        comp({ id: 'other', classId: 'cls-D21', cardNumber: 103 }),
      ],
      classes: [cls('cls-H21'), cls('cls-D21')],
      courses: [course('cls-H21', [31, 32, 33]), course('cls-D21', [32, 34])],
    });

  test('runner missing the voided control → OK; runner who punched it → OK', () => {
    seqCounter = 0;
    const state = project([
      run(101, [p(31), p(33)]),
      run(102, [p(31), p(32), p(33)]),
      run(103, [p(34)]),
      voided(32),
    ]);
    assert.equal(state.competitors.get('missed')!.status, 'OK');
    assert.deepEqual(state.competitors.get('missed')!.missing_codes, []);
    assert.equal(state.competitors.get('punched')!.status, 'OK');
    assert.equal(state.competitors.get('other')!.status, 'OK', 'voiding is course-wide');
  });

  test('unvoid → MP again', () => {
    seqCounter = 0;
    const state = project([run(101, [p(31), p(33)]), voided(32), unvoided(32)]);
    assert.equal(state.competitors.get('missed')!.status, 'MP');
    assert.deepEqual(state.competitors.get('missed')!.missing_codes, [32]);
  });

  test('replayed from events: void before or after the read projects the same', () => {
    seqCounter = 0;
    const before = project([voided(32), run(101, [p(31), p(33)])]);
    seqCounter = 0;
    const after = project([run(101, [p(31), p(33)]), voided(32)]);
    const pick = (v: CompetitorView) => [v.status, v.missing_codes, v.extra_codes];
    assert.deepEqual(pick(before.competitors.get('missed')!), ['OK', [], []]);
    assert.deepEqual(pick(after.competitors.get('missed')!), ['OK', [], []]);
  });
});

// 02.1-14 Task 7: results — shared places; MP/DNF beat max time.
describe('reduce — shared places, MP beats MAX (02.1-14 Task 7)', () => {
  const run = (card: number, punches: NdjsonPunch[], sec: number): Event =>
    cardRead(card, punches, hd(10 * 3600), hd(10 * 3600 + sec));

  test('two OK runners with equal time → both place 1, next is 3', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [run(1, [p(31)], 600), run(2, [p(31)], 600), run(3, [p(31)], 700)],
      competitors: [
        comp({ id: 'a', name: 'A', cardNumber: 1 }),
        comp({ id: 'b', name: 'B', cardNumber: 2 }),
        comp({ id: 'c', name: 'C', cardNumber: 3 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31])],
    });
    const rows = state.results_by_class.get('cls-H21')!;
    assert.deepEqual(
      rows.map((r) => [r.competitor_id, r.place, r.behind_leader_ms]),
      [
        ['a', 1, 0],
        ['b', 1, 0],
        ['c', 3, 100_000],
      ]
    );
  });

  test('SOFT TR 4.20.9: a runner over the max time gets no place and no behind; the OK runners are 1 and 2', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [run(1, [p(31)], 700), run(2, [p(31)], 550), run(3, [p(31)], 500)],
      competitors: [
        comp({ id: 'max', name: 'A', cardNumber: 1 }),
        comp({ id: 'ok2', name: 'B', cardNumber: 2 }),
        comp({ id: 'ok1', name: 'C', cardNumber: 3 }),
      ],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31])],
    });
    const rows = state.results_by_class.get('cls-H21')!;
    assert.deepEqual(
      rows.map((r) => [r.competitor_id, r.status, r.place, r.behind_leader_ms]),
      [
        ['ok1', 'OK', 1, 0],
        ['ok2', 'OK', 2, 50_000],
        ['max', 'MAX', null, null],
      ]
    );
  });

  test('MP runner over max time → MP', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [run(1, [p(31)], 700)],
      competitors: [comp({ id: 'mp', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32])],
    });
    assert.equal(state.competitors.get('mp')!.status, 'MP');
  });

  test('MP runner over max time stays MP through the voided-leg post-pass', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [
        run(1, [p(31), p(33)], 700),
        evt({ event_type: 'leg_voided', competitor_id: 'mp', control_code: 33, max_seconds: 0 }),
      ],
      competitors: [comp({ id: 'mp', cardNumber: 1 })],
      classes: [clsWithMax('cls-H21', 600)],
      courses: [course('cls-H21', [31, 32, 33])],
    });
    assert.equal(state.competitors.get('mp')!.status, 'MP');
  });
});

// Item F (02.1-14 follow-up) used to measure a voided first leg from the
// start the running time uses and subtract it. Since 2026-10-05 a voided leg
// never changes the time (SOFT TR 4.20.10): both runners keep finish − start.
describe('reduce — voided first leg keeps the running time', () => {
  const at = (sec: number): number => localToEpochMs('2026-10-03', sec);
  const t = (sec: number): NdjsonPunch => ({ code: 31, ...hd(sec) });

  test('drawn 10:00, start punch 10:01, 31 at 10:03, finish 10:10; void 31 → time unchanged', () => {
    seqCounter = 0;
    const read = (card: number): Event =>
      cardRead(
        card,
        [t(10 * 3600 + 180), { ...p(32), ...hd(10 * 3600 + 300) }],
        hd(10 * 3600 + 60),
        hd(10 * 3600 + 600),
        {
          eventTimeMs: at(10 * 3600 + 900),
        }
      );
    const voidLeg = (competitor_id: string): Event =>
      evt({ event_type: 'leg_voided', competitor_id, control_code: 31 });
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(101), read(102), voidLeg('drawn'), voidLeg('open')],
      competitors: [
        comp({ id: 'drawn', cardNumber: 101, startTimeMs: at(10 * 3600) }),
        comp({ id: 'open', cardNumber: 102 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32])],
    });
    // Drawn: 10:00 → 10:10. Open start: start punch 10:01 → 10:10.
    assert.equal(state.competitors.get('drawn')!.elapsed_time_ms, 10 * 60 * 1000);
    assert.equal(state.competitors.get('open')!.elapsed_time_ms, 9 * 60 * 1000);
  });
});

// 02.1-14 Task 9: classes without timing (MeOS NoTiming, IOF
// resultListMode="UnorderedNoTimes") — status still computed, no place, no
// time in the result view, rows sorted by name.
describe('reduce — class without timing (02.1-14 Task 9)', () => {
  const run = (card: number, sec: number): Event =>
    cardRead(card, [p(31)], hd(10 * 3600), hd(10 * 3600 + sec));

  test('two OK runners → place null, no time, no behind, sorted by name', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      // Örjan is faster but sorts after Anna by name.
      events: [run(1, 500), run(2, 900)],
      competitors: [
        comp({ id: 'o', name: 'Örjan', cardNumber: 1 }),
        comp({ id: 'a', name: 'Anna', cardNumber: 2 }),
      ],
      classes: [{ ...cls('cls-H21'), noTiming: true }],
      courses: [course('cls-H21', [31])],
    });
    const rows = state.results_by_class.get('cls-H21')!;
    assert.deepEqual(
      rows.map((r) => [r.competitor_id, r.status, r.place, r.elapsed_time_ms, r.behind_leader_ms]),
      [
        ['a', 'OK', null, null, null],
        ['o', 'OK', null, null, null],
      ]
    );
    // The projection keeps the running time internally.
    assert.equal(state.competitors.get('o')!.elapsed_time_ms, 500_000);
    assert.equal(state.competitors.get('o')!.no_timing, true);
  });

  test('a timed class next to it keeps places and times', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [run(1, 500)],
      competitors: [comp({ id: 'h', cardNumber: 1 })],
      classes: [cls('cls-H21'), { ...cls('cls-INS'), noTiming: true }],
      courses: [course('cls-H21', [31])],
    });
    const [row] = state.results_by_class.get('cls-H21')!;
    assert.equal(row!.place, 1);
    assert.equal(row!.elapsed_time_ms, 500_000);
    assert.equal(state.competitors.get('h')!.no_timing, false);
  });
});

// 02.1-14 Task 10: the operator can set MP by hand (MeOS "Felstämplad").
describe('reduce — manual MP (02.1-14 Task 10)', () => {
  const setMp = (competitor_id: string): Event =>
    evt({ event_type: 'manual_status_set', competitor_id, status: 'MP', reason: 'by hand' });
  const okRun = (card: number, sec: number): Event =>
    cardRead(card, [p(31)], hd(10 * 3600), hd(10 * 3600 + sec));
  const base = {
    competition_id: 'comp-1',
    competitors: [comp({ id: 'a', cardNumber: 1 })],
    classes: [cls('cls-H21')],
    courses: [course('cls-H21', [31])],
  };

  test('MP on a runner without a read-out → MP', () => {
    seqCounter = 0;
    const state = reduce({ ...base, events: [setMp('a')] });
    assert.equal(state.competitors.get('a')!.status, 'MP');
  });

  test('MP on an OK read-out → MP', () => {
    seqCounter = 0;
    const state = reduce({ ...base, events: [okRun(1, 600), setMp('a')] });
    assert.equal(state.competitors.get('a')!.status, 'MP');
    assert.equal(state.results_by_class.get('cls-H21')![0]!.place, null);
  });

  // 02.1-14 Task 12 changed this: it said a later read does not override a
  // hand-set MP. As in MeOS (oRunner.cpp:1621-1630) the later read scores.
  test('MP by hand, then a later OK read-out → OK', () => {
    seqCounter = 0;
    const state = reduce({ ...base, events: [okRun(1, 600), setMp('a'), okRun(1, 600)] });
    assert.equal(state.competitors.get('a')!.status, 'OK');
    assert.equal(state.results_by_class.get('cls-H21')![0]!.place, 1);
  });

  test('clear → back to the auto-detected status', () => {
    seqCounter = 0;
    const state = reduce({
      ...base,
      events: [
        okRun(1, 600),
        setMp('a'),
        evt({ event_type: 'clear_manual_status', competitor_id: 'a' }),
      ],
    });
    assert.equal(state.competitors.get('a')!.status, 'OK');
    assert.equal(state.competitors.get('a')!.manual_status, null);
  });

  test('MP set by hand is not promoted to MAX', () => {
    seqCounter = 0;
    const state = reduce({
      ...base,
      classes: [clsWithMax('cls-H21', 300)],
      events: [okRun(1, 600), setMp('a')],
    });
    assert.equal(state.competitors.get('a')!.status, 'MP');
  });
});

// 02.1-14 Task 13: a read with a finish but neither a start punch nor a drawn
// start is flagged, gets no time or place, and a suggested start = the card's
// check punch + the median (check → start punch) of the runners read so far
// (1:54 when fewer than 10 such runners; null without a check punch).
describe('reduce — missing start (02.1-14 Task 13)', () => {
  const at = (sec: number): number => localToEpochMs('2026-10-03', sec);
  const CHECK = 10 * 3600 + 19 * 60 + 37; // 10:19:37
  const read = (
    card: number,
    check: number | null,
    start: number | null,
    finish: number | null = 11 * 3600
  ): Event =>
    evt(
      {
        event_type: 'card_read',
        card_number: card,
        card_type: 'SI10',
        start: start === null ? null : hd(start),
        finish: finish === null ? null : hd(finish),
        check: check === null ? null : hd(check),
        clear: null,
        punch_count: 1,
        punches: [p(31)],
        card_holder: null,
      },
      { eventTimeMs: at(11 * 3600 + 5 * 60) }
    );
  /** `n` reference runners with check 10:00 and start punches 60, 70, …
   * seconds later, plus the runner without a start (card 1). */
  const run = (n: number, target: Event = read(1, CHECK, null)) => {
    seqCounter = 0;
    const refs = Array.from({ length: n }, (_, i) =>
      read(100 + i, 10 * 3600, 10 * 3600 + 60 + 10 * i)
    );
    return reduce({
      competition_id: 'comp-1',
      events: [...refs, target],
      competitors: [
        comp({ id: 'x', cardNumber: 1 }),
        ...refs.map((_, i) => comp({ id: `r${i}`, name: `R${i}`, cardNumber: 100 + i })),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31])],
    });
  };

  test('≥ 10 reference runners → check + their median, no time, no place', () => {
    const state = run(10);
    const x = state.competitors.get('x')!;
    assert.equal(x.missing_start, true);
    assert.equal(x.status, 'OK');
    assert.equal(x.elapsed_time_ms, null);
    // Offsets 60..150 s → median (100 + 110) / 2 = 105 s.
    assert.equal(x.suggested_start_offset_ms, 105_000);
    assert.equal(x.suggested_start_ms, at(CHECK) + 105_000);
    const row = state.results_by_class.get('cls-H21')!.find((r) => r.competitor_id === 'x')!;
    assert.equal(row.place, null);
    assert.equal(row.elapsed_time_ms, null);
    // Runners with a start punch are not flagged.
    assert.equal(state.competitors.get('r0')!.missing_start, false);
    assert.equal(state.competitors.get('r0')!.suggested_start_ms, null);
  });

  // 02.1-14 Task 15: the day's check → start numbers for "Fastställ
  // saknade starttider" (median, mean, n, and the offset actually used).
  test('check → start stats: median, mean, n, offset used', () => {
    assert.deepEqual(run(10).check_to_start, {
      n: 10,
      median_ms: 105_000,
      mean_ms: 105_000,
      offset_ms: 105_000,
    });
    // Fewer than 10: the numbers are shown, but 1:54 is used.
    assert.deepEqual(run(9).check_to_start, {
      n: 9,
      median_ms: 100_000,
      mean_ms: 100_000,
      offset_ms: 114_000,
    });
    assert.deepEqual(run(0).check_to_start, {
      n: 0,
      median_ms: null,
      mean_ms: null,
      offset_ms: 114_000,
    });
  });

  test('< 10 reference runners → check + 1:54', () => {
    const x = run(9).competitors.get('x')!;
    assert.equal(x.missing_start, true);
    assert.equal(x.suggested_start_offset_ms, 114_000);
    assert.equal(x.suggested_start_ms, at(CHECK) + 114_000);
  });

  test('no check punch → flagged, no suggestion', () => {
    const x = run(10, read(1, null, null)).competitors.get('x')!;
    assert.equal(x.missing_start, true);
    assert.equal(x.suggested_start_ms, null);
    assert.equal(x.suggested_start_offset_ms, null);
  });

  test('a drawn start, or no finish, is not a missing start', () => {
    seqCounter = 0;
    const state = reduce({
      competition_id: 'comp-1',
      events: [read(1, CHECK, null), read(2, CHECK, null, null)],
      competitors: [
        comp({ id: 'drawn', cardNumber: 1, startTimeMs: at(10 * 3600 + 20 * 60) }),
        comp({ id: 'dnf', cardNumber: 2 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31])],
    });
    assert.equal(state.competitors.get('drawn')!.missing_start, false);
    assert.equal(state.competitors.get('drawn')!.elapsed_time_ms, 40 * 60 * 1000);
    assert.equal(state.competitors.get('dnf')!.status, 'DNF');
    assert.equal(state.competitors.get('dnf')!.missing_start, false);
  });
});
