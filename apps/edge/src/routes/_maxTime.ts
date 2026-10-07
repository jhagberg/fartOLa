// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.21.2: "Angiven maxtid får inte ändras efter första start."
// The first start has happened once the race has ever been started (a
// `race_started` event in the log — reset-race does not undo it) or the
// earliest drawn start time has passed. Both the competition max time and a
// class max time are locked.

import { and, eq, min } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { competitors, events } from '../db/schema.ts';

export function maxTimeLocked(handle: DbHandle, competitionId: string, nowMs: number): boolean {
  const started = handle.db
    .select({ seq: events.localSeq })
    .from(events)
    .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'race_started')))
    .limit(1)
    .get();
  if (started !== undefined) return true;
  const first = handle.db
    .select({ ms: min(competitors.startTimeMs) })
    .from(competitors)
    .where(eq(competitors.competitionId, competitionId))
    .get();
  const firstStartMs = first?.ms ?? null;
  return firstStartMs !== null && firstStartMs <= nowMs;
}
