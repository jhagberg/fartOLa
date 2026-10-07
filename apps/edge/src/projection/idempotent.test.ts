// Authored for fartola. Not ported from upstream.
//
// REQ-EVT-004 (reducer is deterministic + idempotent). Three gates:
//   1. Re-running reduce over the same event log twice produces
//      structurally identical CompetitionState (every scenario from
//      reduce.test.ts cases 2-12).
//   2. Shuffled-event-order input produces same output as sorted
//      (the reducer sorts internally by (eventTimeMs, localSeq)).
//   3. 1000-event synthetic stream completes in < 200ms (Phase 1
//      single-laptop SLA — UI-SPEC §"Live results auto-update" target).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 2
// - REQ-EVT-004

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { HalfDayClock, NdjsonPunch } from '@fartola/sportident';
import type { Event, Competitor, Class } from '../db/types.ts';
import type { EventPayload } from '../db/schema.ts';
import { reduce, type CourseWithControlCodes } from './reduce.ts';

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
function evt(payload: EventPayload, overrides: Partial<Event> = {}): Event {
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
  overrides: Partial<Event> = {}
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
    ...overrides,
  } as Competitor;
}

function cls(id: string, name = id): Class {
  return {
    id,
    competitionId: 'comp-1',
    name,
    shortName: null,
  } as Class;
}

function course(classId: string, codes: readonly number[]): CourseWithControlCodes {
  return {
    id: `course-${classId}`,
    competitionId: 'comp-1',
    name: `Course ${classId}`,
    classId,
    lengthM: null,
    climbM: null,
    control_codes: codes,
  } as CourseWithControlCodes;
}

/** Serialize a CompetitionState into a stable JSON form for structural
 * comparison. Map → object (keys sorted), other fields preserved. */
function serialize(state: ReturnType<typeof reduce>): string {
  return JSON.stringify(
    {
      competition_id: state.competition_id,
      competitors: Object.fromEntries(
        [...state.competitors.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
      results_by_class: Object.fromEntries(
        [...state.results_by_class.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
      pending_unknown_cards: state.pending_unknown_cards,
      last_event_seq: state.last_event_seq,
    },
    null,
    0
  );
}

describe('reduce — idempotency (REQ-EVT-004)', () => {
  test('test 1: two runs over the same event log produce structurally identical state', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 600)),
      cardRead(2, [p(31), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700)),
      cardRead(3, [p(31), p(32)], hd(10 * 3600), null),
      evt({ event_type: 'manual_dnf', competitor_id: 'c-d', reason: 'foo' }),
      evt({ event_type: 'un_dnf', competitor_id: 'c-d' }),
    ];
    const input = {
      competition_id: 'comp-1',
      clock_offset_min: 120,
      events,
      competitors: [
        comp({ id: 'c-anna', name: 'Anna', cardNumber: 1 }),
        comp({ id: 'c-bo', name: 'Bo', cardNumber: 2 }),
        comp({ id: 'c-cia', name: 'Cia', cardNumber: 3 }),
        comp({ id: 'c-d', name: 'D', cardNumber: 4 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    };
    const a = reduce(input);
    const b = reduce(input);
    assert.equal(serialize(a), serialize(b));
  });

  test('test 2: shuffled-event-order input produces same output as sorted', () => {
    seqCounter = 0;
    const events = [
      cardRead(1, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 500), {
        localSeq: 1,
        eventTimeMs: 1_700_000_000_001,
      }),
      cardRead(2, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 700), {
        localSeq: 2,
        eventTimeMs: 1_700_000_000_002,
      }),
      cardRead(3, [p(31), p(32), p(33), p(34)], hd(10 * 3600), hd(10 * 3600 + 900), {
        localSeq: 3,
        eventTimeMs: 1_700_000_000_003,
      }),
    ];
    const shuffled = [events[2]!, events[0]!, events[1]!];
    const input = {
      competition_id: 'comp-1',
      clock_offset_min: 120,
      competitors: [
        comp({ id: 'c-anna', name: 'Anna', cardNumber: 1 }),
        comp({ id: 'c-bo', name: 'Bo', cardNumber: 2 }),
        comp({ id: 'c-cia', name: 'Cia', cardNumber: 3 }),
      ],
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    };
    const sorted = reduce({ ...input, events });
    const reshuffled = reduce({ ...input, events: shuffled });
    assert.equal(serialize(sorted), serialize(reshuffled));
  });

  test('test 3: 1000-event synthetic stream completes in < 200ms', () => {
    seqCounter = 0;
    // 40 competitors, 25 card_read events per competitor = 1000 events.
    const competitors: Competitor[] = [];
    const events: Event[] = [];
    const N = 40;
    const READS_PER = 25;
    for (let ci = 0; ci < N; ci++) {
      competitors.push(
        comp({
          id: `c-${ci}`,
          name: `Runner-${ci}`,
          cardNumber: 1000 + ci,
        })
      );
    }
    for (let r = 0; r < READS_PER; r++) {
      for (let ci = 0; ci < N; ci++) {
        const elapsedS = 300 + ci * 5 + r;
        events.push(
          cardRead(
            1000 + ci,
            [p(31), p(32), p(33), p(34)],
            hd(10 * 3600),
            hd(10 * 3600 + elapsedS),
            { localSeq: events.length + 1, eventTimeMs: 1_700_000_000_000 + events.length }
          )
        );
      }
    }
    assert.equal(events.length, N * READS_PER);

    const input = {
      competition_id: 'comp-1',
      clock_offset_min: 120,
      events,
      competitors,
      classes: [cls('cls-H21')],
      courses: [course('cls-H21', [31, 32, 33, 34])],
    };

    const start = performance.now();
    const state = reduce(input);
    const elapsed = performance.now() - start;

    assert.ok(
      elapsed < 200,
      `reduce(1000 events × 40 competitors) took ${elapsed.toFixed(2)}ms; budget 200ms`
    );
    assert.equal(state.competitors.size, N);
    assert.equal(state.results_by_class.get('cls-H21')!.length, N);
  });
});
