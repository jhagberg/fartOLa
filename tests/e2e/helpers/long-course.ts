// tests/e2e/helpers/long-course.ts
// Authored for fartola. Not ported from upstream.
//
// Synthetic IOF 3.0 CourseData with a long H21 course and a short D21
// course, for tests that need many punch tiles. No real data.

/** Control codes of the long H21 course: 31, 32, … (n codes). */
export function longCourseCodes(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 31 + i);
}

export function longCourseXml(n: number): string {
  const codes = longCourseCodes(n);
  const control = (c: number): string => `<Control><Id>${c}</Id></Control>`;
  const cc = (c: number | string, type?: string): string =>
    `<CourseControl${type ? ` type="${type}"` : ''}><Control>${c}</Control></CourseControl>`;
  const course = (name: string, list: number[]): string =>
    `<Course><Name>${name}</Name><Length>${list.length * 400}</Length><Climb>${list.length * 10}</Climb>` +
    `${cc('S1', 'Start')}${list.map((c) => cc(c)).join('')}${cc('F1', 'Finish')}</Course>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
  createTime="2026-10-09T12:00:00Z" creator="fartola-test">
  <Event><Name>Designlabb</Name>
    <Class><Name>H21</Name><ShortName>H21</ShortName></Class>
    <Class><Name>D21</Name><ShortName>D21</ShortName></Class>
  </Event>
  <RaceCourseData>
    ${codes.map(control).join('')}
    ${course('Lång', codes)}
    ${course('Kort', codes.slice(0, 4))}
    <ClassCourseAssignment><ClassName>H21</ClassName><CourseName>Lång</CourseName></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21</ClassName><CourseName>Kort</CourseName></ClassCourseAssignment>
  </RaceCourseData>
</CourseData>`;
}
