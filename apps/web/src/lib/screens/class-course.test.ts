// Authored for fartola. Not ported from upstream.

import { describe, it, expect } from 'vitest';
import type { CourseDTO } from '@fartola/shared-types';
import { classCourse, courseLengthLabel } from './class-course.ts';

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
