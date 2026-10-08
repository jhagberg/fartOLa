// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.20.7 / 4.20.8 (2026-07-01): the official time is minutes and
// whole seconds, fractions rounded to the nearest second ("avrundning till
// hel sekund"), and equal official times share the place. One reduced
// state is checked end to end: places, the results rows (route / WS), the
// IOF ResultList, the MOP push and the receipt all carry the rounded time.
// Codex compliance verification: starts 10:00:00.100 / .300, finish
// 10:10:00 → 599.9 / 599.7 s, both 600 s, both place 1.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';

import type { HalfDayClock } from '@fartola/sportident';
import type { Event, Competitor, Class } from '../db/types.ts';
import { reduce, type CourseWithControlCodes } from './reduce.ts';
import { localToEpochMs } from '../time/competitionClock.ts';
import { buildResultListXml } from '../xml/iofExport.ts';
import { buildMopXml } from '../integrations/liveresultat/mopBuilder.ts';
import { receiptTime } from '../print/templates.ts';

const DAY = '2026-10-03';
const at = (sec: number): number => localToEpochMs(DAY, sec);
const hd = (sec: number): HalfDayClock => ({
  seconds_in_half_day: sec % (12 * 3600),
  half_day: sec < 12 * 3600 ? 0 : 1,
  weekday: null,
});
const TEN = 10 * 3600;

let seq = 0;
function read(card: number, finishSec: number): Event {
  seq += 1;
  return {
    nodeId: 'node-A',
    localSeq: seq,
    competitionId: 'comp-1',
    eventType: 'card_read',
    eventTimeMs: at(finishSec + 300),
    recordedAtMs: at(finishSec + 300),
    payload: {
      event_type: 'card_read',
      card_number: card,
      card_type: 'SI10',
      start: null,
      finish: hd(finishSec),
      check: null,
      clear: null,
      punch_count: 1,
      punches: [{ code: 31, seconds_in_half_day: 0, half_day: 0, weekday: null }],
      card_holder: null,
    },
  } as Event;
}

/** A read with a start punch and a finish punch (clocks as the card gave them). */
function readStartFinish(card: number, start: HalfDayClock, finish: HalfDayClock): Event {
  const e = read(card, 0);
  return {
    ...e,
    eventTimeMs: at(TEN + 3600),
    payload: { ...(e.payload as object), start, finish },
  } as Event;
}

function runner(id: string, card: number, startMs: number): Competitor {
  return {
    id,
    competitionId: 'comp-1',
    name: id,
    club: null,
    classId: 'cls-H21',
    cardNumber: card,
    consentAtMs: null,
    consentStatus: 'explicit',
    scrubbedAtMs: null,
    source: 'walkup',
    startTimeMs: startMs,
  } as Competitor;
}

const H21 = {
  id: 'cls-H21',
  competitionId: 'comp-1',
  name: 'H21',
  shortName: null,
  firstStartMs: null,
  startIntervalSec: null,
  maxTimeSec: null,
} as Class;
const COURSE = {
  id: 'course-A',
  competitionId: 'comp-1',
  name: 'A',
  classId: 'cls-H21',
  lengthM: null,
  climbM: null,
  control_codes: [31],
} as CourseWithControlCodes;

// Finish 10:10:00 for all; starts with fractions of a second.
function project(starts: Record<string, number>, classes: Class[] = [H21]) {
  seq = 0;
  const ids = Object.keys(starts);
  return reduce({
    competition_id: 'comp-1',
    clock_offset_min: 120,
    events: ids.map((_, i) => read(100 + i, TEN + 600)),
    competitors: ids.map((id, i) => runner(id, 100 + i, at(TEN) + starts[id]!)),
    classes,
    courses: [COURSE],
  });
}

describe('SOFT TR 4.20.7: official time in whole seconds, rounded', () => {
  test('SOFT TR 4.20.7/4.20.8: 599.9 s and 599.7 s are both 600 s and share place 1', () => {
    const state = project({ a: 100, b: 300, c: 1_400 });
    assert.equal(state.competitors.get('a')!.elapsed_time_ms, 600_000);
    assert.equal(state.competitors.get('b')!.elapsed_time_ms, 600_000);
    assert.equal(state.competitors.get('c')!.elapsed_time_ms, 599_000, '598.6 s → 599 s');
    const rows = state.results_by_class.get('cls-H21')!;
    assert.deepEqual(
      rows.map((r) => [r.competitor_id, r.place, r.elapsed_time_ms, r.behind_leader_ms]),
      [
        ['c', 1, 599_000, 0],
        ['a', 2, 600_000, 1_000],
        ['b', 2, 600_000, 1_000],
      ]
    );
  });

  test('SOFT TR 4.20.7: half a second rounds up (599.5 s → 600 s, 599.4 s → 599 s)', () => {
    const state = project({ up: 500, down: 600 });
    assert.equal(state.competitors.get('up')!.elapsed_time_ms, 600_000);
    assert.equal(state.competitors.get('down')!.elapsed_time_ms, 599_000);
  });

  test('SOFT TR 4.20.7: max time compares the official time (600.4 s ≤ 600 s cap)', () => {
    const state = project({ a: -400 }, [{ ...H21, maxTimeSec: 600 }]);
    assert.equal(state.competitors.get('a')!.elapsed_time_ms, 600_000);
    assert.equal(state.competitors.get('a')!.status, 'OK');
  });

  test('SOFT TR 4.20.7: ResultList, MOP and receipt carry the rounded time (599.7 s → 600 s)', () => {
    const state = project({ b: 300 });
    const xml = buildResultListXml({
      competition: {
        id: 'comp-1',
        name: 'T',
        date: DAY,
        receipt_template: 'classic',
        auto_print: false,
        created_at_ms: 0,
        race_started_at_ms: null,
        timing_format: 'seconds',
        clock_offset_min: 120,
      },
      classes: [
        {
          id: 'cls-H21',
          competition_id: 'comp-1',
          name: 'H21',
          short_name: null,
          no_timing: false,
          start_method: 'auto',
        },
      ],
      courses: [],
      state,
      status: 'Final',
    }).xml;
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
      ResultList: { ClassResult: { PersonResult: { Result: { Time: number; Position: number } } } };
    };
    assert.equal(parsed.ResultList.ClassResult.PersonResult.Result.Time, 600);
    assert.equal(parsed.ResultList.ClassResult.PersonResult.Result.Position, 1);

    const mop = buildMopXml({
      state,
      competition: { id: 'comp-1', name: 'T', date: DAY, clockOffsetMin: 120 },
      classes: [{ id: 'cls-H21', name: 'H21' }],
      clubs: [],
    });
    assert.match(mop, /rt="6000"/);

    assert.equal(receiptTime(state.competitors.get('b')!), '10:00');
  });
});

describe('SOFT TR 4.20.7: subsecond of start and finish punches reaches the official time', () => {
  const sub = (sec: number, subsec_256?: number): HalfDayClock => ({
    ...hd(sec),
    ...(subsec_256 === undefined ? {} : { subsec_256 }),
  });
  // Runner without a drawn start: timed from the start punch (start method auto).
  const official = (start: HalfDayClock, finish: HalfDayClock): number | null => {
    const state = reduce({
      competition_id: 'comp-1',
      clock_offset_min: 120,
      events: [readStartFinish(100, start, finish)],
      competitors: [{ ...runner('a', 100, at(TEN)), startTimeMs: null } as Competitor],
      classes: [H21],
      courses: [COURSE],
    });
    return state.competitors.get('a')!.elapsed_time_ms;
  };
  const FINISH = TEN + 1800; // 10:30:00

  test('start 10:00:00 + finish 10:30:00.5 → 1800.5 s → 1801 s (half up)', () => {
    assert.equal(official(sub(TEN, 0), sub(FINISH, 128)), 1_801_000);
  });

  test('start 10:00:00 + finish 10:30:00.496 → 1800 s (fraction below one half)', () => {
    assert.equal(official(sub(TEN, 0), sub(FINISH, 127)), 1_800_000);
  });

  test('fractions change the whole-second result: .898 start, .101 finish → 1799.2 s → 1799 s', () => {
    assert.equal(official(sub(TEN), sub(FINISH)), 1_800_000, 'whole seconds alone give 1800 s');
    assert.equal(official(sub(TEN, 230), sub(FINISH, 26)), 1_799_000);
  });

  test('fraction 0 equals no fraction', () => {
    assert.equal(official(sub(TEN, 0), sub(FINISH, 0)), official(sub(TEN), sub(FINISH)));
  });
});
