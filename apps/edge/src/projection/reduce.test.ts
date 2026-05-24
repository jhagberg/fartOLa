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
  //   4. A subsequent card_read does NOT overwrite the override.
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

  // Test 11: voided leg elapsed recomputation — subtract leg duration
  test('test 11: voided leg — elapsed recalculated by subtracting voided leg duration', () => {
    seqCounter = 0;
    // Anna has punches: 31 at 10:00:00, 32 at 10:01:00 (60s leg), finish at 10:05:00 (300s total).
    // Voiding control 32 (60s leg, no cap) → elapsed = 300 - 60 = 240s.
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
    // Original elapsed = 300s. Voided leg 32: punch_at_32 - punch_at_31 = 120-60 = 60s. Subtract 60s → 240s.
    assert.equal(anna.elapsed_time_ms, 240 * 1000);
  });

  // Test 12: voided leg with max_seconds cap — subtract min(actual, cap)
  test('test 12: voided leg with max_seconds cap — subtracts min(actual, cap)', () => {
    seqCounter = 0;
    // Anna's leg 32 is 90s actual, but max_seconds is 60 → subtract 60s.
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
        max_seconds: 60, // cap at 60s even though actual leg is 90s
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
    // Original elapsed = 300s. Voided leg actual = 90s but capped at 60s → subtract 60s → 240s.
    assert.equal(anna.elapsed_time_ms, 240 * 1000);
  });
});
