// Authored for fartola. Not ported from upstream.
//
// What the IOF ResultList needs beyond the projection, shared by the export
// download and the Eventor push: the courses (length per class, SOFT TR
// 7.8.2), each runner's Eventor person id (SOFT TA till TR 7.8.3) and any
// start set as a wall-clock time (competitors.start_wall_ms).

import { and, eq, isNotNull } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { competitors } from '../db/schema.ts';
import type { ExportInput } from '../xml/iofExport.ts';
import { loadCourseDTOs } from './_courses.ts';

export function resultListInputs(
  handle: DbHandle,
  competitionId: string
): Pick<ExportInput, 'courses' | 'eventorPersonIds' | 'startWallMs'> {
  const ids = handle.db
    .select({ id: competitors.id, eventorPersonId: competitors.eventorPersonId })
    .from(competitors)
    .where(
      and(eq(competitors.competitionId, competitionId), isNotNull(competitors.eventorPersonId))
    )
    .all();
  const walls = handle.db
    .select({ id: competitors.id, startWallMs: competitors.startWallMs })
    .from(competitors)
    .where(and(eq(competitors.competitionId, competitionId), isNotNull(competitors.startWallMs)))
    .all();
  return {
    courses: loadCourseDTOs(handle, competitionId),
    eventorPersonIds: new Map(ids.map((r) => [r.id, r.eventorPersonId!])),
    startWallMs: new Map(walls.map((r) => [r.id, r.startWallMs!])),
  };
}
