// Authored for fartola. Not ported from upstream.
//
// node:test coverage for draw/startClash.ts (SOFT TA till TR 6.5.1 /
// TR 7.5.3, first paragraph).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { clockToEpochMs } from '../time/competitionClock.ts';
import { controlsByClass, startClashes, type ClassStarts } from './startClash.ts';

const OFFSET = 120; // UTC+2, CEST
/** Epoch ms at h:m:s on the competition clock. */
const at = (h: number, m: number, s = 0): number =>
  clockToEpochMs('2026-05-24', h * 3600 + m * 60 + s, OFFSET);

const cls = (
  id: string,
  controls: number[] | null,
  startsMs: number[],
  intervalSec: number | null = 120
): ClassStarts => ({ id, name: id, controls, intervalSec, startsMs });

describe('startClashes', () => {
  test('SOFT TA till TR 6.5.1 / TR 7.5.3: same course, same minute is a clash, named by class and minute', () => {
    const r = startClashes(
      [
        cls('H21', [31, 32, 33], [at(10, 0), at(10, 2), at(10, 4)]),
        // Seconds into the same minute still clash.
        cls('D21', [31, 32, 33], [at(10, 1), at(10, 2, 30), at(10, 5)]),
      ],
      OFFSET
    );
    assert.deepEqual(r.same_course, [
      {
        class_id: 'D21',
        class_name: 'D21',
        other_class_id: 'H21',
        other_class_name: 'H21',
        minutes: ['10:02'],
      },
    ]);
    assert.deepEqual(r.same_first_control, []);
  });

  test('SOFT TA till TR 6.5.1 / TR 7.5.3: same course in different minutes is no clash', () => {
    const r = startClashes(
      [
        cls('H21', [31, 32, 33], [at(10, 0), at(10, 2)]),
        cls('D21', [31, 32, 33], [at(10, 1), at(10, 3)]),
      ],
      OFFSET
    );
    assert.deepEqual(r, { same_course: [], same_first_control: [] });
  });

  test('SOFT TA till TR 6.5.1 / TR 7.5.3: same first control on another course, same minute is a warning only', () => {
    const r = startClashes(
      [
        cls('H21', [31, 32, 33], [at(10, 0), at(10, 2)]),
        cls('H35', [31, 40, 41], [at(10, 2), at(10, 4)]),
      ],
      OFFSET
    );
    assert.deepEqual(r.same_course, []);
    assert.deepEqual(
      r.same_first_control.map((c) => [c.class_name, c.other_class_name, c.minutes]),
      [['H21', 'H35', ['10:02']]]
    );
  });

  test('SOFT TA till TR 6.5.1 / TR 7.5.3: different courses and first controls never clash, nor classes without a course or with a mass start', () => {
    const r = startClashes(
      [
        cls('H21', [31, 32, 33], [at(10, 0)]),
        // The same controls in another order is another course.
        cls('D21', [32, 31, 33], [at(10, 0)]),
        cls('D10', null, [at(10, 0)]),
        cls('H10', null, [at(10, 0)]),
        cls('Mass', [31, 32, 33], [at(10, 0), at(10, 0)], 0),
      ],
      OFFSET
    );
    assert.deepEqual(r, { same_course: [], same_first_control: [] });
  });

  test('starts a day apart are different minutes (overnight)', () => {
    const r = startClashes(
      [cls('H21', [31], [at(23, 59)]), cls('D21', [31], [at(23, 59) + 24 * 3600 * 1000])],
      OFFSET
    );
    assert.deepEqual(r.same_course, []);
  });
});

describe('controlsByClass', () => {
  test("the class's course wins over the legacy course pointing at the class", () => {
    const m = controlsByClass(
      [
        { id: 'a', courseId: 'x' },
        { id: 'b', courseId: null },
        { id: 'c', courseId: null },
      ],
      [
        { id: 'x', classId: null, controls: [1, 2] },
        { id: 'y', classId: 'a', controls: [9] },
        { id: 'z', classId: 'b', controls: [3] },
      ]
    );
    assert.deepEqual([...m].sort(), [
      ['a', [1, 2]],
      ['b', [3]],
    ]);
  });
});
