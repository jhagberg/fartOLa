// Authored for fartola. Not ported from upstream.
//
// The edit dialog's read of a runner: start source, late start, punches
// with missing and by-hand controls, never read. Synthetic data.

import { describe, it, expect } from 'vitest';
import { clockToEpochMs, parseTimeOfDay } from '@fartola/shared-types';
import type { CorrectionsDTO } from '#lib/api/client.ts';
import { cardClockText, courseCodes, toEditRunnerRead } from './edit-runner-read.ts';

const OFFSET = 120;
const at = (text: string): number => clockToEpochMs('2026-10-09', parseTimeOfDay(text)!, OFFSET);
const clock = (text: string) => ({ seconds_in_half_day: parseTimeOfDay(text)!, half_day: 0 });
const p = (code: number, text: string) => ({ code, ...clock(text) });
const ctx = {
  clockOffsetMin: OFFSET,
  expectedCodes: [31, 32, 33, 34, 35, 36],
  voidedCodes: [],
  noTiming: false,
};

const read = (over: Partial<CorrectionsDTO> = {}): CorrectionsDTO => ({
  status: 'MP',
  elapsed_time_ms: null,
  start_ms: at('10:00:00'),
  read_at_ms: at('10:20:00'),
  drawn_start_ms: at('10:00:00'),
  late_start_ms: null,
  read_count: 1,
  latest_read: {
    card_type: 'SI10',
    start: clock('10:00:00'),
    finish: clock('10:12:00'),
    punches: [
      p(31, '10:02:00'),
      p(32, '10:04:00'),
      p(33, '10:06:00'),
      p(34, '10:08:00'),
      p(36, '10:10:00'),
    ],
  },
  missing_codes: [35],
  manual_finish_ms: null,
  manual_finish_reason: null,
  manual_punches: [],
  time_addition_min: 0,
  time_addition_reason: null,
  ...over,
});

describe('toEditRunnerRead', () => {
  it('shows the course with the missing control and a finish row', () => {
    const v = toEditRunnerRead(read(), ctx);
    expect(v.verdict).toBe(true);
    expect(v.punches.map((x) => [x.code, x.ok ?? null])).toEqual([
      [31, true],
      [32, true],
      [33, true],
      [34, true],
      [35, false],
      [36, true],
      ['F', null],
    ]);
    expect(v.finish).toEqual({ time: '10:12:00', byHand: false });
    expect(v.readAt).toBe('10:20:00');
    expect(v.neverRead).toBe(false);
  });

  it('marks a missed control punched by hand as manual', () => {
    const v = toEditRunnerRead(
      read({
        status: 'OK',
        missing_codes: [],
        manual_punches: [{ control_code: 35, reason: 'Stiftklämma' }],
      }),
      ctx
    );
    const tile = v.punches.find((x) => x.code === 35)!;
    expect(tile.manual).toBe(true);
    expect(tile.ok).toBe(true);
    expect(v.manualPunches).toEqual([{ code: 35, reason: 'Stiftklämma' }]);
  });

  it('says which start the time runs from', () => {
    expect(toEditRunnerRead(read(), ctx).start).toEqual({
      drawn: '10:00:00',
      punch: '10:00:00',
      from: 'drawn',
    });
    const punched = toEditRunnerRead(read({ start_ms: at('10:03:12') }), ctx).start;
    expect(punched).toEqual({ drawn: '10:00:00', punch: '10:00:00', from: 'punch' });
    const none = toEditRunnerRead(
      read({
        start_ms: null,
        drawn_start_ms: null,
        latest_read: null,
        read_count: 0,
        read_at_ms: null,
      }),
      ctx
    );
    expect(none.start).toEqual({ drawn: null, punch: null, from: null });
  });

  it('takes the late start from the payload only', () => {
    expect(toEditRunnerRead(read(), ctx).lateStart).toBeNull();
    expect(toEditRunnerRead(read({ late_start_ms: 192_000 }), ctx).lateStart).toBe('3:12');
  });

  it('is never read only with no read and a zero count', () => {
    const none = { latest_read: null, read_count: 0, read_at_ms: null };
    expect(toEditRunnerRead(read(none), ctx).neverRead).toBe(true);
    expect(toEditRunnerRead(read({ ...none, read_count: 2 }), ctx).neverRead).toBe(false);
  });

  it('a finish by hand wins over the card finish', () => {
    const v = toEditRunnerRead(read({ manual_finish_ms: at('10:11:30') }), ctx);
    expect(v.finish).toEqual({ time: '10:11:30', byHand: true });
  });

  it('shows a time addition as its own line, none when 0', () => {
    expect(toEditRunnerRead(read(), ctx).timeAddition).toBeNull();
    const v = toEditRunnerRead(
      read({ time_addition_min: 1, time_addition_reason: 'Tjuvstart' }),
      ctx
    );
    expect(v.timeAddition).toEqual({ min: 1, reason: 'Tjuvstart' });
  });

  it('plain punches without a course, no times without timing', () => {
    const v = toEditRunnerRead(read(), { ...ctx, expectedCodes: [], noTiming: true });
    expect(v.verdict).toBe(false);
    expect(v.punches.every((x) => x.split === '—')).toBe(true);
    expect(v.elapsed).toBeNull();
  });
});

describe('courseCodes and cardClockText', () => {
  const course = (id: string, class_id: string | null, codes: number[]) =>
    ({
      id,
      competition_id: 'c',
      name: id,
      class_id,
      length_m: null,
      climb_m: null,
      controls: codes.map((control_code, order_idx) => ({ control_code, order_idx })).reverse(),
    }) as never;
  it('class.course_id wins over a course pointing at the class; order by order_idx', () => {
    const courses = [course('a', 'k', [1, 2]), course('b', null, [7, 8, 9])];
    expect(courseCodes({ id: 'k', course_id: 'b' }, courses)).toEqual([7, 8, 9]);
    expect(courseCodes({ id: 'k', course_id: null }, courses)).toEqual([1, 2]);
    expect(courseCodes({ id: 'x', course_id: null }, courses)).toEqual([]);
    expect(courseCodes(undefined, courses)).toEqual([]);
  });
  it('adds the PM half day', () => {
    expect(cardClockText({ seconds_in_half_day: 3600, half_day: 1 })).toBe('13:00:00');
  });
});
