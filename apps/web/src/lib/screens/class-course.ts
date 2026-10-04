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

/** "H21 · Bana A · 4,2 km": the class, its course and length, as far as
 * known; `courseWord` is the localised "Bana". */
export function classHeading(
  cls: Pick<ClassDTO, 'id' | 'name' | 'course_id'>,
  courses: readonly CourseDTO[],
  courseWord: string
): string {
  const course = classCourse(cls, courses);
  if (course === undefined) return cls.name;
  const length = courseLengthLabel(course.length_m);
  return [cls.name, `${courseWord} ${course.name}`, length].filter((s) => s !== null).join(' · ');
}

/** The results screen's tables: the selected class, or for 'ALL' every class
 * with rows, in class order — each under its heading with course length, so
 * the default view too shows class and course length (SOFT TR 7.8.2). */
export function resultGroups<R>(
  activeId: string,
  classes: readonly Pick<ClassDTO, 'id' | 'name' | 'course_id'>[],
  rowsByClass: ReadonlyMap<string, R[]>,
  courses: readonly CourseDTO[],
  courseWord: string
): Array<{ classId: string; heading: string; rows: R[] }> {
  const shown =
    activeId === 'ALL'
      ? classes.filter((c) => (rowsByClass.get(c.id) ?? []).length > 0)
      : classes.filter((c) => c.id === activeId);
  return shown.map((c) => ({
    classId: c.id,
    heading: classHeading(c, courses, courseWord),
    rows: rowsByClass.get(c.id) ?? [],
  }));
}
