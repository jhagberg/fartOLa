// Authored for fartola. Not ported from upstream.
//
// node:test coverage for detectStatus. The 10 LOCKED scenarios from plan
// 01-07 task 1 verify gate. Test 2b is the explicit codex C-H2 regression
// gate: finish=null → DNF regardless of how many control punches were
// collected (a clean run with no finish stamp is genuinely DNF, NOT MP).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-12
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { NdjsonPunch, HalfDayClock } from '@fartola/sportident';
import { detectStatus } from './dnfMp.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

/** Build a HalfDayClock from a "seconds since the day's midnight" scalar.
 * Wraps modulo 24h. */
function hd(totalSeconds: number): HalfDayClock {
  const wrapped = ((totalSeconds % (24 * 3600)) + 24 * 3600) % (24 * 3600);
  return {
    seconds_in_half_day: wrapped % (12 * 3600),
    half_day: wrapped < 12 * 3600 ? 0 : 1,
    weekday: null,
  };
}

/** Minimal NdjsonPunch — only `code` matters for MP detection. */
function p(code: number): NdjsonPunch {
  return { code, seconds_in_half_day: 0, half_day: 0, weekday: null };
}

const COURSE = [31, 32, 33, 34] as const;

/** 02.1-14 Task 3: card-clock context — a SIAC (PM bit trusted) read at
 * 13:00 on the race day, no drawn start. Tests override as needed. */
const DAY = '2026-10-03';
const CTX = {
  cardType: 'SIAC',
  readAtMs: localToEpochMs(DAY, 13 * 3600),
  drawnStartMs: null as number | null,
};

describe('detectStatus — OK / MP / DNF + elapsed', () => {
  test('test 1 OK: 4 controls in order with finish stamped → status=OK, elapsed=600s', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: hd(10 * 3600 + 600),
        punches: [p(31), p(32), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.equal(result.elapsed_time_ms, 600 * 1000);
    assert.deepEqual(result.missing_codes, []);
    assert.deepEqual(result.extra_codes, []);
    assert.deepEqual(result.out_of_order_codes, []);
  });

  test('test 2 DNF (finish=null) — incomplete punches → DNF gate fires', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: null,
        punches: [p(31), p(32)],
      },
      COURSE
    );
    assert.equal(result.status, 'DNF');
    assert.equal(result.elapsed_time_ms, null);
    assert.deepEqual(result.missing_codes, [31, 32, 33, 34]);
    assert.deepEqual(result.extra_codes, [31, 32]);
    assert.deepEqual(result.out_of_order_codes, []);
  });

  test('test 2b NEW (codex C-H2 explicit gate): finish=null trumps a FULL set of punches', () => {
    // All 4 controls present in the right order, but no finish stamp →
    // DNF, NOT OK. This is the explicit regression gate against the
    // revision-1 bug where the reducer would have read "finish punch =
    // code 2 OR 3 in punches[]" and emitted MP.
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: null,
        punches: [p(31), p(32), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'DNF');
    assert.equal(result.elapsed_time_ms, null);
    assert.deepEqual(result.missing_codes, [31, 32, 33, 34]);
    assert.deepEqual(result.extra_codes, [31, 32, 33, 34]);
  });

  test('test 3 MP missing-middle: punches [31,33,34] missing 32', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: hd(10 * 3600 + 600),
        punches: [p(31), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'MP');
    assert.deepEqual(result.missing_codes, [32]);
    assert.deepEqual(result.extra_codes, []);
    assert.deepEqual(result.out_of_order_codes, []);
    assert.equal(result.elapsed_time_ms, 600 * 1000);
  });

  // 02.1-14 Task 2: rewritten. The old expectation (stray punch → MP) encoded
  // the exact-sequence rule this plan replaces with the orienteering rule:
  // course controls in order as a subsequence, extra punches allowed.
  test('test 4 OK extra: a stray code 99 is listed in extra_codes but is not MP', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: hd(10 * 3600 + 600),
        punches: [p(31), p(32), p(99), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.deepEqual(result.extra_codes, [99]);
    assert.deepEqual(result.missing_codes, []);
    assert.deepEqual(result.out_of_order_codes, []);
  });

  // 02.1-14 Task 2: expectations updated. Under the subsequence rule 32 is
  // matched after 31, so 33 (punched only before 32) is missing; it is also
  // reported as out-of-order and its unused punch as extra.
  test('test 5 MP out-of-order: punches [31,33,32,34] flag 33 as out-of-order', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: hd(10 * 3600 + 600),
        punches: [p(31), p(33), p(32), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'MP');
    assert.deepEqual(result.out_of_order_codes, [33]);
    assert.deepEqual(result.missing_codes, [33]);
    assert.deepEqual(result.extra_codes, [33]);
  });

  test('test 6: elapsed=null when no start', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: null,
        finish: hd(10 * 3600 + 600),
        punches: [p(31), p(32), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.equal(result.elapsed_time_ms, null);
  });

  test('test 7: empty punches AND finish=null → DNF, elapsed=null', () => {
    const result = detectStatus({ ...CTX, start: null, finish: null, punches: [] }, COURSE);
    assert.equal(result.status, 'DNF');
    assert.equal(result.elapsed_time_ms, null);
    assert.deepEqual(result.missing_codes, [31, 32, 33, 34]);
  });

  test('test 8: empty punches but finish present → MP (all controls missing)', () => {
    const result = detectStatus(
      {
        ...CTX,
        start: hd(10 * 3600),
        finish: hd(10 * 3600 + 5),
        punches: [],
      },
      COURSE
    );
    assert.equal(result.status, 'MP');
    assert.deepEqual(result.missing_codes, [31, 32, 33, 34]);
    assert.equal(result.elapsed_time_ms, 5000);
  });

  test('test 9: elapsed across midnight wrap (23:50 → 00:10 next day = 20 min)', () => {
    // Construct HalfDayClocks explicitly (hd() wraps modulo 24h so we
    // build them by hand to keep the cross-midnight semantics explicit).
    const start: HalfDayClock = {
      seconds_in_half_day: 11 * 3600 + 50 * 60,
      half_day: 1,
      weekday: null,
    };
    const finish: HalfDayClock = {
      seconds_in_half_day: 10 * 60,
      half_day: 0,
      weekday: null,
    };
    // 02.1-14 Task 3: read after midnight so the 23:50 start is placed on the previous day.
    const result = detectStatus(
      {
        ...CTX,
        readAtMs: localToEpochMs('2026-10-04', 15 * 60),
        start,
        finish,
        punches: [p(31), p(32), p(33), p(34)],
      },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.equal(result.elapsed_time_ms, 20 * 60 * 1000);
  });

  test('test 10: elapsed across AM/PM half-day boundary (11:50 → 12:10 = 20 min)', () => {
    const start = hd(11 * 3600 + 50 * 60);
    const finish = hd(12 * 3600 + 10 * 60);
    const result = detectStatus(
      { ...CTX, start, finish, punches: [p(31), p(32), p(33), p(34)] },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.equal(result.elapsed_time_ms, 20 * 60 * 1000);
  });

  // 02.1-14 Task 2: course controls in order as a subsequence of the punches.
  const FIN = { ...CTX, start: hd(10 * 3600), finish: hd(10 * 3600 + 600) };

  test('subsequence: extras anywhere (before, between, after) → OK', () => {
    const result = detectStatus(
      { ...FIN, punches: [p(99), p(31), p(32), p(98), p(33), p(34), p(97)] },
      COURSE
    );
    assert.equal(result.status, 'OK');
    assert.deepEqual(result.missing_codes, []);
    assert.deepEqual(result.extra_codes, [99, 98, 97]);
  });

  test('subsequence: double punch at a control → OK', () => {
    const result = detectStatus({ ...FIN, punches: [p(31), p(32), p(32), p(33), p(34)] }, COURSE);
    assert.equal(result.status, 'OK');
    assert.deepEqual(result.extra_codes, [32]);
  });

  test('subsequence: butterfly [31,32,31,33] punched 31,32,31,33 → OK', () => {
    const result = detectStatus(
      { ...FIN, punches: [p(31), p(32), p(31), p(33)] },
      [31, 32, 31, 33]
    );
    assert.equal(result.status, 'OK');
    assert.deepEqual(result.missing_codes, []);
    assert.deepEqual(result.extra_codes, []);
  });

  test('subsequence: butterfly [31,32,31,33] punched 31,32,33 → MP missing [31]', () => {
    const result = detectStatus({ ...FIN, punches: [p(31), p(32), p(33)] }, [31, 32, 31, 33]);
    assert.equal(result.status, 'MP');
    assert.deepEqual(result.missing_codes, [31]);
  });

  test('subsequence: wrong order [32,31] for course [31,32] → MP, 32 missing/out-of-order/extra', () => {
    const result = detectStatus({ ...FIN, punches: [p(32), p(31)] }, [31, 32]);
    assert.equal(result.status, 'MP');
    assert.deepEqual(result.missing_codes, [32]);
    assert.deepEqual(result.out_of_order_codes, [32]);
    assert.deepEqual(result.extra_codes, [32]);
  });

  // 02.1-14 Task 3: elapsed is measured from the drawn start when there is one.
  const RUN = [p(31), p(32), p(33), p(34)];

  test('drawn start 10:00 + start punch 10:01 + finish 10:45 → 45 min (drawn wins)', () => {
    const result = detectStatus(
      {
        ...CTX,
        drawnStartMs: localToEpochMs(DAY, 10 * 3600),
        start: hd(10 * 3600 + 60),
        finish: hd(10 * 3600 + 45 * 60),
        punches: RUN,
      },
      COURSE
    );
    assert.equal(result.elapsed_time_ms, 45 * 60 * 1000);
  });

  test('no drawn start + start punch 10:01 + finish 10:45 → 44 min', () => {
    const result = detectStatus(
      { ...CTX, start: hd(10 * 3600 + 60), finish: hd(10 * 3600 + 45 * 60), punches: RUN },
      COURSE
    );
    assert.equal(result.elapsed_time_ms, 44 * 60 * 1000);
  });

  test('neither drawn start nor start punch → elapsed null, status still OK / MP', () => {
    const ok = detectStatus(
      { ...CTX, start: null, finish: hd(10 * 3600 + 45 * 60), punches: RUN },
      COURSE
    );
    assert.equal(ok.status, 'OK');
    assert.equal(ok.elapsed_time_ms, null);
    const mp = detectStatus(
      { ...CTX, start: null, finish: hd(10 * 3600 + 45 * 60), punches: [p(31)] },
      COURSE
    );
    assert.equal(mp.status, 'MP');
    assert.equal(mp.elapsed_time_ms, null);
  });

  test('SI5 start 11:50 + finish 00:20 (half_day 0) read at 12:25 → 30 min', () => {
    const raw = (sec: number): HalfDayClock => ({
      seconds_in_half_day: sec,
      half_day: 0,
      weekday: null,
    });
    const result = detectStatus(
      {
        ...CTX,
        cardType: 'SI5',
        readAtMs: localToEpochMs(DAY, 12 * 3600 + 25 * 60),
        start: raw(11 * 3600 + 50 * 60),
        finish: raw(20 * 60),
        punches: RUN,
      },
      COURSE
    );
    assert.equal(result.elapsed_time_ms, 30 * 60 * 1000);
  });
});
