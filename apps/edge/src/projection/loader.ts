// Authored for fartola. Not ported from upstream.
//
// Lift the per-competition projection inputs out of SQLite into a ReduceInput
// the plan-07 reducer can consume. Reads:
//
//   - competitors (FK competitions.id)
//   - classes     (FK competitions.id)
//   - courses     (FK competitions.id) + course_controls JOIN controls to
//     resolve each course's ordered control_codes list.
//   - events      (FK competitions.id; competition_id IS NULL events are
//     skipped because the reducer is per-competition).
//
// The loader is pure: no caching, no mutation, no broadcast. The projection
// store (./store.ts) wraps it with a Map-backed cache + debounced recompute.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-08-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-09 D-11 D-12

import { eq, asc } from 'drizzle-orm';

import {
  events,
  competitions,
  classes,
  courses,
  courseControls,
  controls,
  competitors,
  courseReplacements,
} from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { ReduceInput, CourseWithControlCodes } from './reduce.ts';

/**
 * Read all projection inputs for `competitionId` and produce a ReduceInput.
 * Returns null when the competition row does not exist — the caller (plan 08
 * ProjectionStore) treats this as a silent no-op (no broadcast, no cache).
 */
export function loadCompetitionInputs(handle: DbHandle, competitionId: string): ReduceInput | null {
  const competition = handle.db
    .select({ id: competitions.id, raceStartedAtMs: competitions.raceStartedAtMs })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (!competition) return null;

  const competitorsRows = handle.db
    .select()
    .from(competitors)
    .where(eq(competitors.competitionId, competitionId))
    .all();

  const classesRows = handle.db
    .select()
    .from(classes)
    .where(eq(classes.competitionId, competitionId))
    .all();

  const coursesRows = handle.db
    .select()
    .from(courses)
    .where(eq(courses.competitionId, competitionId))
    .all();

  const coursesWithCodes: CourseWithControlCodes[] = coursesRows.map((c) => {
    const codeRows = handle.db
      .select({ code: controls.code, orderIdx: courseControls.orderIdx })
      .from(courseControls)
      .innerJoin(controls, eq(courseControls.controlId, controls.id))
      .where(eq(courseControls.courseId, c.id))
      .orderBy(asc(courseControls.orderIdx))
      .all();
    return { ...c, control_codes: codeRows.map((r) => r.code) };
  });

  const eventsRows = handle.db
    .select()
    .from(events)
    .where(eq(events.competitionId, competitionId))
    .orderBy(asc(events.eventTimeMs), asc(events.localSeq))
    .all();

  // Phase 2.1 (D-15): load course_replacements and build the nested map
  // courseId → (controlCode → alternativeCodes[]).
  const replacementRows = handle.db
    .select({
      courseId: courseReplacements.courseId,
      controlCode: courseReplacements.controlCode,
      alternativeCode: courseReplacements.alternativeCode,
    })
    .from(courseReplacements)
    .where(eq(courseReplacements.competitionId, competitionId))
    .all();

  const replacementControls = new Map<string, Map<number, number[]>>();
  for (const row of replacementRows) {
    let courseMap = replacementControls.get(row.courseId);
    if (courseMap === undefined) {
      courseMap = new Map();
      replacementControls.set(row.courseId, courseMap);
    }
    let alternatives = courseMap.get(row.controlCode);
    if (alternatives === undefined) {
      alternatives = [];
      courseMap.set(row.controlCode, alternatives);
    }
    alternatives.push(row.alternativeCode);
  }

  return {
    competition_id: competitionId,
    race_started_at_ms: competition.raceStartedAtMs,
    events: eventsRows,
    competitors: competitorsRows,
    classes: classesRows,
    courses: coursesWithCodes,
    replacementControls: replacementControls as ReadonlyMap<string, ReadonlyMap<number, number[]>>,
  };
}
