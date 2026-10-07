// Authored for fartola. Not ported from upstream.
//
// The competition clock (ADR-0017) for views that turn a typed time of day
// into a start time. Fetched fresh, never cached: the operator can correct
// the offset while a view is open, and the server then shifts every stored
// start to keep its clock time, so a stale offset would misplace both the
// starts shown and the starts entered.

import { getCompetition } from '#lib/api/client.ts';

export interface CompetitionClock {
  /** 'YYYY-MM-DD', the day typed times of day are on. */
  date: string;
  /** UTC offset in minutes: clock = epoch + offset. */
  offsetMin: number;
}

/** The competition clock as the server has it now. */
export async function fetchCompetitionClock(competitionId: string): Promise<CompetitionClock> {
  const { competition } = await getCompetition(competitionId);
  return { date: competition.date, offsetMin: competition.clock_offset_min };
}
