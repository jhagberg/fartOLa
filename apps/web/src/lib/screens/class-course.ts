// Authored for fartola. Not ported from upstream.
//
// SOFT TR 7.8.2: "I resultatlista ska klass och banlängd framgå." The
// results screen shows the active class's course and length; the course is
// the class's course_id, else the course whose class_id is the class (as the
// reducer and the ResultList export resolve it).

import type { ClassDTO, CourseDTO } from '@fartola/shared-types';

export function classCourse(
  cls: Pick<ClassDTO, 'id' | 'course_id'>,
  courses: readonly CourseDTO[]
): CourseDTO | undefined {
  return courses.find((c) => c.id === cls.course_id) ?? courses.find((c) => c.class_id === cls.id);
}

/** 4200 → "4,2 km" (Swedish decimal comma); null when the length is unknown. */
export function courseLengthLabel(lengthM: number | null): string | null {
  if (lengthM === null) return null;
  return `${(Math.round(lengthM / 100) / 10).toFixed(1).replace('.', ',')} km`;
}
