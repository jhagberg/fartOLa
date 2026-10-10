// Authored for fartola. Not ported from upstream.
//
// The competition clock (ADR-0017) for views that turn a typed time of day
// into a start time. Fetched fresh, never cached: the operator can correct
// the offset while a view is open, and the server then shifts every stored
// start to keep its clock time, so a stale offset would misplace both the
// starts shown and the starts entered.

import { formatClockTime } from '@fartola/shared-types';
import { getCompetition } from '#lib/api/client.ts';
import { t } from '#lib/i18n/index.ts';

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

/** HH:MM on the competition clock, marked when it falls on a later day
 * than the competition date (a night race closing after midnight). */
export function clockHmLabel(ms: number, clock: CompetitionClock): string {
  const hm = formatClockTime(ms, clock.offsetMin).slice(0, 5);
  const day = new Date(ms + clock.offsetMin * 60_000).toISOString().slice(0, 10);
  return day > clock.date ? t('clock.nextDay', { time: hm }) : hm;
}
