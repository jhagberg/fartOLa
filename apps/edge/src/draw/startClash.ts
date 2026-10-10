// Authored for fartola. Not ported from upstream.
//
// SOFT TA till TR 6.5.1 / TR 7.5.3 (first paragraph): at interval start,
// classes on the same course must not start at the same time, and classes
// that start together should not share the first control. startClashes
// finds both across classes; the draw route refuses the first (409
// start_clash, overridable with a reason) and warns about the second, and
// "Kontroll inför tävlingen" lists both. MeOS warns the same way after a
// draw ("Samma bana och starttid i X", oEventDraw.cpp:1351; the adjacent
// start time, oEventDraw.cpp:1367, is not checked here); this is own code.
//
// Same course = the identical ordered sequence of control codes, not the
// same course id: a course file often has one course per class with the
// same controls (IOF CourseData exports a course per class), and runners
// on those classes meet in the forest all the same. Two classes without a
// course (or with an empty one) are never the same course.
//
// Same time = the same minute on the competition clock (ADR-0012). The
// clock offset is a whole number of minutes, so the minute boundaries are
// those of epoch time and the key is floor(ms / 60 000); the offset only
// gives the HH:MM label. epochToClockSeconds is not used for the key: it
// wraps at midnight, and starts a day apart (overnight relays) would clash.

import { formatClockTime } from '../time/competitionClock.ts';

export interface ClassStarts {
  id: string;
  name: string;
  /** The class course's control codes in order; null = no course. */
  controls: readonly number[] | null;
  /** The class's start interval; 0 is a mass start, which the rule (at
   * interval start) does not cover. */
  intervalSec: number | null;
  /** Epoch ms of every start in the class. */
  startsMs: readonly number[];
}

export interface StartClash {
  class_id: string;
  class_name: string;
  other_class_id: string;
  other_class_name: string;
  /** The minutes both classes start in, 'HH:MM' on the competition clock, in order. */
  minutes: string[];
}

export interface StartClashes {
  /** Same course, same minute: not allowed. */
  same_course: StartClash[];
  /** Same first control (different course), same minute: should be avoided. */
  same_first_control: StartClash[];
}

const MIN_MS = 60_000;

/** Every pair of interval-start classes that start in the same minute on
 * the same course, or on different courses with the same first control.
 * Classes sorted by name; one entry per pair. */
export function startClashes(classes: readonly ClassStarts[], offsetMin: number): StartClashes {
  const timed = classes
    .filter(
      (c) =>
        c.intervalSec !== 0 && c.controls !== null && c.controls.length > 0 && c.startsMs.length > 0
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
    .map((c) => {
      const minutes = new Map<number, string>();
      for (const ms of [...c.startsMs].sort((a, b) => a - b)) {
        const key = Math.floor(ms / MIN_MS);
        if (!minutes.has(key)) minutes.set(key, formatClockTime(ms, offsetMin).slice(0, 5));
      }
      return { c, course: c.controls!.join(','), first: c.controls![0], minutes };
    });
  const out: StartClashes = { same_course: [], same_first_control: [] };
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      const list =
        a.course === b.course
          ? out.same_course
          : a.first === b.first
            ? out.same_first_control
            : null;
      if (list === null) continue;
      const minutes = [...a.minutes]
        .filter(([key]) => b.minutes.has(key))
        .sort(([x], [y]) => x - y)
        .map(([, label]) => label);
      if (minutes.length > 0)
        list.push({
          class_id: a.c.id,
          class_name: a.c.name,
          other_class_id: b.c.id,
          other_class_name: b.c.name,
          minutes,
        });
    }
  return out;
}

/** Each class's course controls: the class's course_id, else the legacy
 * course whose class_id points at the class (as preRaceCheck and the
 * reducer). Classes without a course are left out. */
export function controlsByClass(
  classes: ReadonlyArray<{ id: string; courseId: string | null }>,
  courses: ReadonlyArray<{ id: string; classId: string | null; controls: readonly number[] }>
): Map<string, readonly number[]> {
  const byId = new Map(courses.map((c) => [c.id, c.controls]));
  const out = new Map<string, readonly number[]>();
  for (const c of courses) if (c.classId !== null) out.set(c.classId, c.controls);
  for (const cls of classes) {
    const assigned = cls.courseId ? byId.get(cls.courseId) : undefined;
    if (assigned) out.set(cls.id, assigned);
  }
  return out;
}
