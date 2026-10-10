// Authored for fartola. Not ported from upstream.
//
// The IOF StartList's classes, shared by the export download and the
// Eventor push: per class its course (name, length, climb) and start place,
// per runner name, club, start time and bib (SOFT TR 7.5.4).

import { eq } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { classes, competitors } from '../db/schema.ts';
import type { StartListClass } from '../xml/iofExport.ts';
import { loadCourseDTOs } from './_courses.ts';

export function startListClasses(handle: DbHandle, competitionId: string): StartListClass[] {
  const classRows = handle.db
    .select()
    .from(classes)
    .where(eq(classes.competitionId, competitionId))
    .all();
  const runners = handle.db
    .select({
      name: competitors.name,
      club: competitors.club,
      classId: competitors.classId,
      startTimeMs: competitors.startTimeMs,
      bib: competitors.bib,
    })
    .from(competitors)
    .where(eq(competitors.competitionId, competitionId))
    .all();
  const courses = loadCourseDTOs(handle, competitionId);
  return classRows.map((cls) => {
    // The class's course_id, else the legacy course whose class_id matches.
    const course =
      cls.courseId !== null
        ? courses.find((c) => c.id === cls.courseId)
        : courses.find((c) => c.class_id === cls.id);
    return {
      name: cls.name,
      ...(course !== undefined
        ? { course: { name: course.name, lengthM: course.length_m, climbM: course.climb_m } }
        : {}),
      startName: cls.startName,
      competitors: runners
        .filter((r) => r.classId === cls.id)
        .map((r) => ({
          name: r.name,
          club: r.club,
          startTimeMs: r.startTimeMs,
          ...(r.bib !== null ? { bibNumber: r.bib } : {}),
        })),
    };
  });
}
