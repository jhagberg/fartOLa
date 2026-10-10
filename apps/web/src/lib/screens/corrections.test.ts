// Authored for fartola. Not ported from upstream.
//
// The correction panel's logic: a finish typed by hand (SOFT TR 4.20.6)
// placed on the competition clock, and the lines the readout card shows.

import { describe, it, expect } from 'vitest';
import { clockToEpochMs, parseTimeOfDay } from '@fartola/shared-types';

import { correctionLines, parseControlCode, resolveFinishInput } from './corrections.ts';

const clock = { date: '2026-10-03', offsetMin: 120 };
const at = (text: string, day = '2026-10-03'): number =>
  clockToEpochMs(day, parseTimeOfDay(text)!, 120);

describe('resolveFinishInput', () => {
  it('a time after the start time is that time', () => {
    expect(resolveFinishInput('10:42:30', { startMs: at('10:00'), readAtMs: null }, clock)).toEqual(
      {
        finishMs: at('10:42:30'),
      }
    );
  });

  it('after midnight against a late start is the next day', () => {
    expect(resolveFinishInput('00:10', { startMs: at('23:50'), readAtMs: null }, clock)).toEqual({
      finishMs: at('00:10', '2026-10-04'),
    });
  });

  it('before the start is refused; not a time is refused', () => {
    expect(resolveFinishInput('09:59', { startMs: at('10:00'), readAtMs: null }, clock)).toEqual({
      error: 'before_start',
    });
    expect(resolveFinishInput('tio', { startMs: at('10:00'), readAtMs: null }, clock)).toEqual({
      error: 'invalid',
    });
  });

  it('without a start time, the last such time before the read-out', () => {
    // Read 00:20 on the 4th: a finish typed 23:58 is the evening before.
    expect(
      resolveFinishInput('23:58', { startMs: null, readAtMs: at('00:20', '2026-10-04') }, clock)
    ).toEqual({ finishMs: at('23:58') });
    // The competition is dated the 3rd, but the read-out was on the 4th.
    expect(
      resolveFinishInput('10:07:30', { startMs: null, readAtMs: at('10:20', '2026-10-04') }, clock)
    ).toEqual({ finishMs: at('10:07:30', '2026-10-04') });
  });

  it('without a start time or a read-out the competition day is used', () => {
    expect(resolveFinishInput('10:42', { startMs: null, readAtMs: null }, clock)).toEqual({
      finishMs: at('10:42'),
    });
  });
});

describe('correctionLines', () => {
  it('a finish by hand shows its time and reason; none shows nothing', () => {
    expect(
      correctionLines(
        {
          manual_finish_ms: at('10:42:30'),
          manual_finish_reason: 'Enheten',
          manual_punches: [],
          time_addition_min: 0,
          time_addition_reason: null,
        },
        120
      )
    ).toEqual([{ key: 'corr.line.finish', vars: { time: '10:42:30', reason: 'Enheten' } }]);
    expect(
      correctionLines(
        {
          manual_finish_ms: null,
          manual_finish_reason: null,
          manual_punches: [],
          time_addition_min: 0,
          time_addition_reason: null,
        },
        120
      )
    ).toEqual([]);
  });
});

describe('correctionLines — punches by hand', () => {
  it('one line per punch, in the order entered', () => {
    expect(
      correctionLines(
        {
          manual_finish_ms: null,
          manual_finish_reason: null,
          manual_punches: [
            { control_code: 32, reason: 'Stift' },
            { control_code: 35, reason: 'Stift' },
          ],
          time_addition_min: 0,
          time_addition_reason: null,
        },
        120
      ).map((l) => l.vars.code)
    ).toEqual(['32', '35']);
  });
});

describe('parseControlCode', () => {
  it('a positive whole number is a code; anything else is not', () => {
    expect(parseControlCode(' 32 ')).toBe(32);
    for (const text of ['', '0', '3.5', '-1', 'abc', '32a'])
      expect(parseControlCode(text)).toBeNull();
  });
});

describe('correctionLines — time addition', () => {
  it('shows the minutes and why; 0 shows nothing', () => {
    const row = {
      manual_finish_ms: null,
      manual_finish_reason: null,
      manual_punches: [],
      time_addition_reason: 'Tjuvstart',
    };
    expect(correctionLines({ ...row, time_addition_min: 1 }, 120)).toEqual([
      { key: 'corr.line.addition', vars: { minutes: '1', reason: 'Tjuvstart' } },
    ]);
    expect(correctionLines({ ...row, time_addition_min: 0 }, 120)).toEqual([]);
  });
});
