// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for fetchCompetitionClock: an offset corrected on the
// server reaches an open view on its next fetch (Codex review of the
// fixed-offset clock, finding 3).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { clockToEpochMs, formatClockTime } from '@fartola/shared-types';
import { clockHmLabel, fetchCompetitionClock } from './competition-clock.ts';

const competitionWith = (offset: number): Response =>
  new Response(
    JSON.stringify({
      competition: { id: 'c1', date: '2026-03-29', clock_offset_min: offset },
      classes: [],
      courses: [],
    }),
    { status: 200 }
  );

describe('fetchCompetitionClock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches on every call: a corrected offset is used at once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(competitionWith(120))
      .mockResolvedValueOnce(competitionWith(60));
    global.fetch = fetchMock as unknown as typeof fetch;

    const before = await fetchCompetitionClock('c1');
    expect(before).toEqual({ date: '2026-03-29', offsetMin: 120 });
    const after = await fetchCompetitionClock('c1');
    expect(after).toEqual({ date: '2026-03-29', offsetMin: 60 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/competitions/c1');

    // 01:50 typed after the correction is 01:50 on the new clock, which is
    // what the server (having shifted its stored starts) shows.
    const start = clockToEpochMs(after.date, 3600 + 50 * 60, after.offsetMin);
    expect(formatClockTime(start, 60)).toBe('01:50:00');
    expect(start).toBe(Date.parse('2026-03-29T00:50:00Z'));
  });
});

describe('clockHmLabel', () => {
  it('a night race closing after midnight says it is the next day', () => {
    const clock = { date: '2026-10-08', offsetMin: 120 };
    // 23:30 and 02:00 on the clock (UTC+2).
    expect(clockHmLabel(Date.UTC(2026, 9, 8, 21, 30), clock)).toBe('23:30');
    expect(clockHmLabel(Date.UTC(2026, 9, 9, 0, 0), clock)).toBe('02:00 (dagen efter)');
  });
});
