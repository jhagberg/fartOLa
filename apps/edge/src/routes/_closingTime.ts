// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.16.3, TR 4.22.1: the competition is over, and the finish
// closes, when the max time of the last starter has run out; the time goes
// in the PM. Last start is the latest start time of any runner (a vacancy
// has no runner, so a late entrant in one moves it). Each runner's max time
// is the competition's (TR 4.21.1), else the class's, as in the reducer
// (projection/reduce.ts); a runner with neither leaves the closing time
// unknown. Runners without a start
// time (free start, TR 7.4.3) are not counted.

import { and, eq, isNotNull } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { classes, competitions, competitors } from '../db/schema.ts';

export interface ClosingTime {
  /** Epoch ms; null when nobody has a start time or a starter has no max time. */
  closing_time_ms: number | null;
  /** The latest start time, epoch ms; null when nobody has one. */
  last_start_ms: number | null;
}

export function closingTime(handle: DbHandle, competitionId: string): ClosingTime {
  const comp = handle.db
    .select({ maxTimeSec: competitions.maxTimeSec })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  const rows = handle.db
    .select({ startTimeMs: competitors.startTimeMs, classMaxSec: classes.maxTimeSec })
    .from(competitors)
    .leftJoin(classes, eq(classes.id, competitors.classId))
    .where(and(eq(competitors.competitionId, competitionId), isNotNull(competitors.startTimeMs)))
    .all();
  let closing: number | null = null;
  let last: number | null = null;
  let unknown = false;
  for (const r of rows) {
    const start = r.startTimeMs!;
    if (last === null || start > last) last = start;
    const maxSec = comp?.maxTimeSec ?? r.classMaxSec ?? null;
    if (maxSec === null) unknown = true;
    else if (closing === null || start + maxSec * 1000 > closing) closing = start + maxSec * 1000;
  }
  return { closing_time_ms: unknown ? null : closing, last_start_ms: last };
}
