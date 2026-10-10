// Authored for fartola. Not ported from upstream.
//
// Status of a competition for the home cards, from its date (compared with
// the local calendar day) and whether the race has been started.
import type { CompetitionDTO } from '@fartola/shared-types';

export type CompetitionStatus = 'running' | 'today' | 'finished' | 'upcoming';

/** Local calendar day as YYYY-MM-DD. */
export function localDate(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function competitionStatus(
  c: Pick<CompetitionDTO, 'date' | 'race_started_at_ms'>,
  now: Date = new Date()
): CompetitionStatus {
  const today = localDate(now);
  if (c.date < today) return 'finished';
  if (c.date > today) return 'upcoming';
  return c.race_started_at_ms === null ? 'today' : 'running';
}
