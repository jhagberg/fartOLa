// Authored for fartola. Not ported from upstream.
//
// node:test coverage for ingestCourseData. Covers:
//   - test 1: sample ParsedCourseData → 2 classes / 4 controls / 2 courses,
//     course_controls inserted in declared order.
//   - test 2: re-running the same import is idempotent at the class + control
//     layer (existing rows reused).
//   - test 3: a Course referencing an unknown control code → ingester throws
//     and the wrapping transaction aborts (no partial writes).
//   - test 4 (C-H3 mid-tx seam): opts.outerTransaction=true makes the
//     ingester throw synchronously inside the caller's transaction; the
//     /from-wizard endpoint relies on this for its rollback contract.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';

import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import {
  classes,
  competitions,
  competitors,
  controls,
  courses,
  courseControls,
} from '../db/schema.ts';
import { ingestCourseData } from './courseImport.ts';
import type { ParsedCourseData } from '../xml/parse.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { reduce } from '../projection/reduce.ts';
import type { Event } from '../db/types.ts';

interface Ctx {
  handle: DbHandle;
  competitionId: string;
}

function bootCtx(): Ctx {
  const handle = openDatabase(':memory:');
  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Ingest Test',
      date: '2026-05-14',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
    })
    .run();
  return { handle, competitionId };
}

const SAMPLE: ParsedCourseData = {
  kind: 'CourseData',
  event_name: 'StorTuna Tisdag',
  classes: [
    { id: 'H21', name: 'H21', short_name: 'H21' },
    { id: 'D21', name: 'D21', short_name: 'D21' },
  ],
  controls: [{ code: 31 }, { code: 32 }, { code: 33 }, { code: 34 }],
  courses: [
    {
      id: 'Bana 1',
      name: 'Bana 1',
      class_id_ref: 'H21',
      length_m: 3500,
      climb_m: 45,
      control_codes: [31, 32, 33, 34],
    },
    {
      id: 'Bana 2',
      name: 'Bana 2',
      class_id_ref: 'D21',
      length_m: 2800,
      climb_m: 30,
      control_codes: [34, 33, 32, 31],
    },
  ],
};

describe('ingestCourseData', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = bootCtx();
  });
  afterEach(() => {
    ctx.handle.close();
  });

  test('test 1: writes 2 classes, 4 controls, 2 courses with ordered course_controls', () => {
    const result = ingestCourseData(ctx.handle, ctx.competitionId, SAMPLE);
    assert.deepEqual(result, {
      classes_created: 2,
      controls_created: 4,
      courses_created: 2,
    });

    // Classes persisted with correct competition_id.
    const classRows = ctx.handle.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    assert.equal(classRows.length, 2);
    const names = classRows.map((r) => r.name).sort();
    assert.deepEqual(names, ['D21', 'H21']);

    // Controls.
    const controlRows = ctx.handle.db
      .select()
      .from(controls)
      .where(eq(controls.competitionId, ctx.competitionId))
      .all();
    const codes = controlRows.map((r) => r.code).sort((a, b) => a - b);
    assert.deepEqual(codes, [31, 32, 33, 34]);

    // Courses.
    const courseRows = ctx.handle.db
      .select()
      .from(courses)
      .where(eq(courses.competitionId, ctx.competitionId))
      .all();
    assert.equal(courseRows.length, 2);
    const bana1 = courseRows.find((c) => c.name === 'Bana 1');
    assert.ok(bana1);
    assert.equal(bana1.lengthM, 3500);
    assert.equal(bana1.climbM, 45);
    // class_id should be the H21 row id, not the source XML's local 'H21' string.
    const h21 = classRows.find((c) => c.name === 'H21');
    assert.ok(h21);
    assert.equal(bana1.classId, h21.id);

    // course_controls for Bana 1 in correct order.
    const cc1 = ctx.handle.db
      .select()
      .from(courseControls)
      .where(eq(courseControls.courseId, bana1.id))
      .all()
      .sort((a, b) => a.orderIdx - b.orderIdx);
    assert.equal(cc1.length, 4);
    // Resolve the codes via control rows.
    const idToCode = new Map(controlRows.map((r) => [r.id, r.code]));
    const orderedCodes = cc1.map((cc) => idToCode.get(cc.controlId));
    assert.deepEqual(orderedCodes, [31, 32, 33, 34]);
  });

  test('test 2: re-running the same input is idempotent for classes + controls', () => {
    ingestCourseData(ctx.handle, ctx.competitionId, SAMPLE);
    const r2 = ingestCourseData(ctx.handle, ctx.competitionId, SAMPLE);
    // Second pass: classes + controls already exist; courses are fresh.
    assert.equal(r2.classes_created, 0);
    assert.equal(r2.controls_created, 0);
    assert.equal(r2.courses_created, 2);

    // Total class rows still 2, total controls still 4.
    const classRows = ctx.handle.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    assert.equal(classRows.length, 2);
    const controlRows = ctx.handle.db
      .select()
      .from(controls)
      .where(eq(controls.competitionId, ctx.competitionId))
      .all();
    assert.equal(controlRows.length, 4);
  });

  test('test 3: unknown control code → ingest throws, transaction aborts', () => {
    const bad: ParsedCourseData = {
      ...SAMPLE,
      controls: [{ code: 31 }, { code: 32 }],
      courses: [
        {
          id: 'Bana 1',
          name: 'Bana 1',
          class_id_ref: null,
          length_m: null,
          climb_m: null,
          control_codes: [31, 32, 99], // 99 not in controls list
        },
      ],
    };
    assert.throws(
      () => ingestCourseData(ctx.handle, ctx.competitionId, bad),
      /Course Bana 1 references unknown control 99/
    );
    // Transaction rolled back — no class / control / course rows for this
    // competition.
    const classRows = ctx.handle.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    assert.equal(classRows.length, 0);
    const controlRows = ctx.handle.db
      .select()
      .from(controls)
      .where(eq(controls.competitionId, ctx.competitionId))
      .all();
    assert.equal(controlRows.length, 0);
    const courseRows = ctx.handle.db
      .select()
      .from(courses)
      .where(eq(courses.competitionId, ctx.competitionId))
      .all();
    assert.equal(courseRows.length, 0);
  });

  test('test 5 (Phase 2.0 course-only fallback): zero classes + N courses → synthesises 1:1 class-per-course wired into course.class_id', () => {
    // 4-klubbs Condes export shape: 5 <Course> elements, ZERO <Class>
    // elements. Phase 2.0 promised "course-only model works for the
    // 4-klubbs 5-course bundle" (ROADMAP SC#5). Without this fallback
    // the WalkupModal Bana picker is empty.
    const courseOnly: ParsedCourseData = {
      kind: 'CourseData',
      event_name: '4-klubbs 2026',
      classes: [],
      controls: [{ code: 31 }, { code: 32 }, { code: 33 }],
      courses: [
        {
          id: 'Vit',
          name: 'Vit',
          class_id_ref: null,
          length_m: 1875,
          climb_m: null,
          control_codes: [31, 32, 33],
        },
        {
          id: 'Grön',
          name: 'Grön',
          class_id_ref: null,
          length_m: 1525,
          climb_m: null,
          control_codes: [31, 33],
        },
      ],
    };
    const r = ingestCourseData(ctx.handle, ctx.competitionId, courseOnly);
    assert.equal(r.classes_created, 2);
    assert.equal(r.courses_created, 2);

    const classRows = ctx.handle.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    assert.equal(classRows.length, 2);
    const classNames = classRows.map((c) => c.name).sort();
    assert.deepEqual(classNames, ['Grön', 'Vit']);

    const courseRows = ctx.handle.db
      .select()
      .from(courses)
      .where(eq(courses.competitionId, ctx.competitionId))
      .all();
    assert.equal(courseRows.length, 2);
    // Every course MUST have a class_id pointing at its synthesised class.
    for (const cr of courseRows) {
      assert.ok(cr.classId, `course ${cr.name} should have a synthesised classId`);
      const matchingClass = classRows.find((c) => c.id === cr.classId);
      assert.ok(matchingClass, `course ${cr.name}.classId must reference a real class row`);
      assert.equal(matchingClass.name, cr.name, 'synthesised class shares course name');
    }
  });

  test('test 6 (Phase 2.0 course-only fallback): when classes ARE present, fallback does NOT fire (idempotent)', () => {
    // Defensive: the fallback must only trigger when classes.length===0.
    // Sanity-check that the existing 2-classes/2-courses SAMPLE still
    // produces exactly 2 classes (not 4) — re-asserts the SAMPLE
    // path is unaffected by the new branch.
    const r = ingestCourseData(ctx.handle, ctx.competitionId, SAMPLE);
    assert.equal(r.classes_created, 2);
    assert.equal(r.courses_created, 2);
    const classRows = ctx.handle.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    assert.equal(classRows.length, 2);
  });

  test('test 4 (C-H3 mid-tx seam): outerTransaction=true throws synchronously inside caller tx', () => {
    const bad: ParsedCourseData = {
      ...SAMPLE,
      controls: [{ code: 31 }],
      courses: [
        {
          id: 'Phantom',
          name: 'Phantom',
          class_id_ref: null,
          length_m: null,
          climb_m: null,
          control_codes: [31, 99],
        },
      ],
    };
    let thrown = false;
    assert.throws(
      () => {
        ctx.handle.sqlite.transaction(() => {
          ingestCourseData(ctx.handle, ctx.competitionId, bad, { outerTransaction: true });
        })();
      },
      (e: Error) => {
        thrown = true;
        return /unknown control 99/.test(e.message);
      }
    );
    assert.equal(thrown, true);
    // No rows committed.
    const courseRows = ctx.handle.db
      .select()
      .from(courses)
      .where(eq(courses.competitionId, ctx.competitionId))
      .all();
    assert.equal(courseRows.length, 0);
  });

  // 02.1-14 Task 4: classes point at courses; many classes per course.
  const SHARED: ParsedCourseData = {
    kind: 'CourseData',
    event_name: 'Shared course',
    classes: [
      { id: 'H21', name: 'H21', short_name: null },
      { id: 'D21', name: 'D21', short_name: null },
    ],
    controls: [{ code: 31 }, { code: 32 }],
    courses: [
      {
        id: 'Bana 1',
        name: 'Bana 1',
        class_id_ref: 'D21',
        class_refs: ['H21', 'D21'],
        length_m: null,
        climb_m: null,
        control_codes: [31, 32],
      },
    ],
  };

  function classCourseIds(): Map<string, string | null> {
    const rows = ctx.handle.db
      .select({ name: classes.name, courseId: classes.courseId })
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    return new Map(rows.map((r) => [r.name, r.courseId]));
  }

  test('two classes assigned to one course → both classes have the course', () => {
    ingestCourseData(ctx.handle, ctx.competitionId, SHARED);
    const course = ctx.handle.db.select().from(courses).get();
    assert.ok(course);
    const ids = classCourseIds();
    assert.equal(ids.get('H21'), course.id);
    assert.equal(ids.get('D21'), course.id);
  });

  test('two classes on one course → both competitors get OK on a clean run', () => {
    ingestCourseData(ctx.handle, ctx.competitionId, SHARED);
    ctx.handle.db
      .update(competitions)
      .set({ raceStartedAtMs: 0 })
      .where(eq(competitions.id, ctx.competitionId))
      .run();
    const ids = ctx.handle.db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(eq(classes.competitionId, ctx.competitionId))
      .all();
    for (const [i, c] of ids.entries()) {
      ctx.handle.db
        .insert(competitors)
        .values({
          id: `comp-${c.name}`,
          competitionId: ctx.competitionId,
          name: c.name,
          classId: c.id,
          cardNumber: 1000 + i,
        })
        .run();
    }
    const clock = (sec: number) => ({ seconds_in_half_day: sec, half_day: 0, weekday: null });
    const reads = ids.map(
      (_, i) =>
        ({
          nodeId: 'n',
          localSeq: i + 1,
          competitionId: ctx.competitionId,
          eventType: 'card_read',
          eventTimeMs: Date.parse('2026-05-14T09:00:00Z'),
          recordedAtMs: 0,
          payload: {
            event_type: 'card_read',
            card_number: 1000 + i,
            card_type: 'SIAC',
            start: clock(36000),
            finish: clock(36600),
            check: null,
            clear: null,
            punch_count: 2,
            punches: [
              { code: 31, ...clock(36100) },
              { code: 32, ...clock(36200) },
            ],
            card_holder: null,
          },
        }) as Event
    );
    // A class without a course would accept any punches, so also prove the
    // course reaches H21: a runner there who skips 32 is MP.
    const h21 = ids.find((c) => c.name === 'H21')!;
    ctx.handle.db
      .insert(competitors)
      .values({
        id: 'comp-H21-mp',
        competitionId: ctx.competitionId,
        name: 'MP',
        classId: h21.id,
        cardNumber: 2000,
      })
      .run();
    const mpRead = structuredClone(reads[0]!);
    const mpPayload = mpRead.payload as { card_number: number; punches: unknown[] };
    mpPayload.card_number = 2000;
    mpPayload.punches = mpPayload.punches.slice(0, 1);
    const state = reduce({
      ...loadCompetitionInputs(ctx.handle, ctx.competitionId)!,
      events: [...reads, mpRead],
    });
    assert.equal(state.competitors.get('comp-H21')?.status, 'OK');
    assert.equal(state.competitors.get('comp-D21')?.status, 'OK');
    assert.equal(state.competitors.get('comp-H21-mp')?.status, 'MP');
  });

  test('zero <Class> elements: synthesised classes still get their course (course-only)', () => {
    const courseOnly: ParsedCourseData = {
      ...SHARED,
      classes: [],
      courses: [{ ...SHARED.courses[0]!, class_id_ref: null, class_refs: [] }],
    };
    ingestCourseData(ctx.handle, ctx.competitionId, courseOnly);
    const course = ctx.handle.db.select().from(courses).get();
    assert.deepEqual([...classCourseIds()], [['Bana 1', course!.id]]);
  });

  test('re-import does not duplicate classes and re-points them at the new course', () => {
    ingestCourseData(ctx.handle, ctx.competitionId, SHARED);
    ingestCourseData(ctx.handle, ctx.competitionId, SHARED);
    const ids = classCourseIds();
    assert.equal(ids.size, 2);
    // Courses still get fresh rows per import (documented in courseImport.ts);
    // classes follow the newest one.
    const newest = ctx.handle.sqlite
      .prepare<unknown[], { id: string }>('SELECT id FROM courses ORDER BY rowid DESC LIMIT 1')
      .get();
    assert.equal(ids.get('H21'), newest!.id);
    assert.equal(ids.get('D21'), newest!.id);
  });
});
