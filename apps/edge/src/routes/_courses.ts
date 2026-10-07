// Authored for fartola. Not ported from upstream.
//
// A competition's courses as CourseDTOs with their controls in order. Used
// by GET /api/competitions/:id and the IOF ResultList exports (course
// length per class, SOFT TR 7.8.2).

import { asc, eq } from 'drizzle-orm';

import type { CourseControlDTO, CourseDTO } from '@fartola/shared-types';
import type { DbHandle } from '../db/index.ts';
import { controls, courseControls, courses } from '../db/schema.ts';

export function loadCourseDTOs(handle: DbHandle, competitionId: string): CourseDTO[] {
  // Two SELECTs: courses for the competition, then a single joined SELECT of
  // all course_controls × controls for those courses ordered by
  // (course_id, order_idx). Group in TS by course_id.
  const courseRows = handle.db
    .select()
    .from(courses)
    .where(eq(courses.competitionId, competitionId))
    .orderBy(asc(courses.name))
    .all();
  const controlsByCourse = new Map<string, CourseControlDTO[]>();
  for (const c of courseRows) controlsByCourse.set(c.id, []);
  if (courseRows.length > 0) {
    const joined = handle.db
      .select({
        courseId: courseControls.courseId,
        orderIdx: courseControls.orderIdx,
        code: controls.code,
      })
      .from(courseControls)
      .innerJoin(controls, eq(courseControls.controlId, controls.id))
      .where(eq(controls.competitionId, competitionId))
      .orderBy(asc(courseControls.courseId), asc(courseControls.orderIdx))
      .all();
    for (const row of joined) {
      const arr = controlsByCourse.get(row.courseId);
      if (arr) arr.push({ control_code: row.code, order_idx: row.orderIdx });
    }
  }
  return courseRows.map((c) => ({
    id: c.id,
    competition_id: c.competitionId,
    name: c.name,
    class_id: c.classId,
    length_m: c.lengthM,
    climb_m: c.climbM,
    controls: controlsByCourse.get(c.id) ?? [],
  }));
}
