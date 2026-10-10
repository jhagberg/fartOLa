// Authored for fartola. Not ported from upstream.
import { describe, expect, it } from 'vitest';
import { competitionStatus, localDate } from './competitionStatus.ts';

describe('localDate', () => {
  it('uses the local calendar day, also just after midnight and just before', () => {
    expect(localDate(new Date(2026, 9, 10, 0, 0, 0))).toBe('2026-10-10');
    expect(localDate(new Date(2026, 9, 10, 23, 59, 59))).toBe('2026-10-10');
    expect(localDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});

describe('competitionStatus', () => {
  const noon = new Date(2026, 9, 10, 12);
  it('today is running once the race is started, otherwise today', () => {
    expect(competitionStatus({ date: '2026-10-10', race_started_at_ms: 1 }, noon)).toBe('running');
    expect(competitionStatus({ date: '2026-10-10', race_started_at_ms: null }, noon)).toBe('today');
  });
  it('past is finished and future is upcoming, regardless of start', () => {
    expect(competitionStatus({ date: '2026-10-09', race_started_at_ms: 1 }, noon)).toBe('finished');
    expect(competitionStatus({ date: '2026-10-09', race_started_at_ms: null }, noon)).toBe(
      'finished'
    );
    expect(competitionStatus({ date: '2026-10-11', race_started_at_ms: null }, noon)).toBe(
      'upcoming'
    );
  });
  it('flips at local midnight', () => {
    const c = { date: '2026-10-10', race_started_at_ms: null };
    expect(competitionStatus(c, new Date(2026, 9, 9, 23, 59, 59))).toBe('upcoming');
    expect(competitionStatus(c, new Date(2026, 9, 10, 0, 0, 0))).toBe('today');
    expect(competitionStatus(c, new Date(2026, 9, 10, 23, 59, 59))).toBe('today');
    expect(competitionStatus(c, new Date(2026, 9, 11, 0, 0, 0))).toBe('finished');
  });
});
