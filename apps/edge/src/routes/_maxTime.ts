// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.21.2: "Angiven maxtid får inte ändras efter första start."
// The first start has happened once the race is started
// (competitions.race_started_at_ms) or the earliest drawn start time has
// passed. Both the competition max time and a class override are locked.

import { eq, min } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { competitions, competitors } from '../db/schema.ts';

export function maxTimeLocked(handle: DbHandle, competitionId: string, nowMs: number): boolean {
  const comp = handle.db
    .select({ raceStartedAtMs: competitions.raceStartedAtMs })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (comp !== undefined && comp.raceStartedAtMs !== null) return true;
  const first = handle.db
    .select({ ms: min(competitors.startTimeMs) })
    .from(competitors)
    .where(eq(competitors.competitionId, competitionId))
    .get();
  const firstStartMs = first?.ms ?? null;
  return firstStartMs !== null && firstStartMs <= nowMs;
}
