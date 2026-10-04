// Authored for fartola. Not ported from upstream.

import { describe, it, expect } from 'vitest';
import type { CourseDTO } from '@fartola/shared-types';
import { classCourse, courseLengthLabel, resultGroups } from './class-course.ts';

const course = (over: Partial<CourseDTO>): CourseDTO => ({
  id: 'k',
  competition_id: 'c',
  name: 'A',
  class_id: null,
  length_m: null,
  climb_m: null,
  controls: [],
  ...over,
});

describe('class course on the results screen', () => {
  it('SOFT TR 7.8.2: the results screen shows the class course length', () => {
    const courses = [
      course({ id: 'k1', name: 'Bana 1', length_m: 4200 }),
      course({ id: 'k2', name: 'Bana 2', class_id: 'd21', length_m: 3550 }),
    ];
    // course_id wins; the legacy course.class_id pointer is the fallback.
    expect(classCourse({ id: 'h21', course_id: 'k1' }, courses)?.name).toBe('Bana 1');
    expect(classCourse({ id: 'd21', course_id: null }, courses)?.name).toBe('Bana 2');
    expect(classCourse({ id: 'x', course_id: null }, courses)).toBeUndefined();
    expect(courseLengthLabel(4200)).toBe('4,2 km');
    expect(courseLengthLabel(3550)).toBe('3,6 km');
    expect(courseLengthLabel(null)).toBeNull();
  });
});

describe('results screen groups (SOFT TR 7.8.2)', () => {
  const row = (id: string) => ({ competitor_id: id });
  const classes = [
    { id: 'h21', name: 'H21', course_id: 'k1' },
    { id: 'd21', name: 'D21', course_id: null },
    { id: 'tom', name: 'Tom', course_id: null },
  ];
  const courses = [
    course({ id: 'k1', name: 'A', length_m: 4200 }),
    course({ id: 'k2', name: 'B', class_id: 'd21', length_m: 3550 }),
  ];
  const rows = new Map([
    ['d21', [row('b1')]],
    ['h21', [row('a1'), row('a2')]],
  ]);

  it('SOFT TR 7.8.2: the default "all classes" view shows each class under its heading with course and length', () => {
    const groups = resultGroups('ALL', classes, rows, courses, 'Bana');
    expect(groups.map((g) => [g.heading, g.rows.map((r) => r.competitor_id)])).toEqual([
      ['H21 · Bana A · 4,2 km', ['a1', 'a2']],
      ['D21 · Bana B · 3,6 km', ['b1']],
    ]);
  });

  it('SOFT TR 7.8.2: one selected class is one group with the same heading', () => {
    expect(resultGroups('d21', classes, rows, courses, 'Bana')).toEqual([
      { classId: 'd21', heading: 'D21 · Bana B · 3,6 km', rows: [row('b1')] },
    ]);
    // A class without a course still gets its name as the heading.
    expect(resultGroups('tom', classes, rows, courses, 'Bana')).toEqual([
      { classId: 'tom', heading: 'Tom', rows: [] },
    ]);
  });
});
