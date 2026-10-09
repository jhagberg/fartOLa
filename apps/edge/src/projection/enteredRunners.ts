// Authored for fartola. Not ported from upstream.
//
// "Är det någon som är anmäld?" — for an unknown card, the entered runners
// who have not read out yet, ranked by how well they fit the card (todo
// 2026-10-08-unknown-card-entered-runner):
//   1. their class course against the card's punches (matchCourse, the
//      scoring rule): fewest missing controls, then fewest extra punches;
//   2. their start time against the card's start punch, or its check punch
//      plus the usual check → start gap when there is no start punch.
// A runner is `suggested` when the course fits: at most a quarter of its
// controls missing (a mispunching runner still fits). The rest of the list
// is what the operator searches by name and club.

import type { CourseWithControlCodes, ReduceInput } from './reduce.ts';
import { voidedControlCodes } from './reduce.ts';
import { matchCourse } from './dnfMp.ts';
import { cardClockToEpochMs } from './halfDayClockMath.ts';
import type { CompetitionState } from './types.ts';
import type { EventPayload } from '../db/schema.ts';

export interface EnteredRunner {
  competitor_id: string;
  name: string;
  club: string | null;
  class_id: string;
  class_name: string;
  /** The card the entry has now (null: none). */
  card_number: number | null;
  start_time_ms: number | null;
  /** Course controls the card misses, and card punches not on the course;
   * null without a course or without punches to compare. */
  missing: number | null;
  extra: number | null;
  /** |card start − start time| in ms; null when either is unknown. */
  start_diff_ms: number | null;
  suggested: boolean;
}

type CardRead = Extract<EventPayload, { event_type: 'card_read' }>;

export function rankEnteredRunners(
  input: ReduceInput,
  state: CompetitionState,
  cardNumber: number
): EnteredRunner[] {
  // The card's latest read (events are sorted by time).
  let read: { payload: CardRead; atMs: number } | null = null;
  for (const e of input.events) {
    const p = e.payload as EventPayload;
    if (p.event_type === 'card_read' && p.card_number === cardNumber)
      read = { payload: p, atMs: e.eventTimeMs };
  }
  const punched = read?.payload.punches.map((p) => p.code) ?? [];
  const cardStartMs = ((): number | null => {
    if (read === null) return null;
    const at = (c: NonNullable<CardRead['start']>) =>
      cardClockToEpochMs(c, read.payload.card_type, read.atMs, input.clock_offset_min);
    if (read.payload.start !== null) return at(read.payload.start);
    if (read.payload.check !== null) return at(read.payload.check) + state.check_to_start.offset_ms;
    return null;
  })();

  // Course per class as the reducer resolves it: class.courseId, else the
  // course's own class pointer; course-wide voided controls dropped.
  const voided = voidedControlCodes(input.events, input.competition_id);
  const courseById = new Map(input.courses.map((c) => [c.id, c]));
  const courseOf = (classId: string): CourseWithControlCodes | undefined => {
    const cls = input.classes.find((c) => c.id === classId);
    return (
      (cls?.courseId ? courseById.get(cls.courseId) : undefined) ??
      input.courses.find((c) => c.classId === classId)
    );
  };
  const classNames = new Map(input.classes.map((c) => [c.id, c.name]));

  // Read out = a read the race-phase gate lets score (as the reducer does).
  // A pre-race identity scan of the entered card at the registration desk
  // stays in card_read_history but is not a read-out.
  const raceStart = input.race_started_at_ms;
  const readOut = (atMs: number): boolean =>
    raceStart === undefined || (raceStart !== null && atMs >= raceStart);

  const runners: EnteredRunner[] = [];
  for (const view of state.competitors.values()) {
    if (view.card_read_history.some((r) => readOut(r.event_time_ms))) continue;
    const course = courseOf(view.class_id);
    const codes = course?.control_codes.filter((c) => !voided.has(c)) ?? [];
    const match =
      course !== undefined && codes.length > 0 && punched.length > 0
        ? matchCourse(punched, codes, input.replacementControls?.get(course.id))
        : null;
    runners.push({
      competitor_id: view.id,
      name: view.name,
      club: view.club,
      class_id: view.class_id,
      class_name: classNames.get(view.class_id) ?? '',
      card_number: view.card_number,
      start_time_ms: view.start_time_ms,
      missing: match?.missing.length ?? null,
      extra: match?.extra.length ?? null,
      start_diff_ms:
        cardStartMs === null || view.start_time_ms === null
          ? null
          : Math.abs(cardStartMs - view.start_time_ms),
      suggested: match !== null && match.missing.length <= Math.floor(codes.length / 4),
    });
  }
  const last = (n: number | null) => n ?? Number.MAX_SAFE_INTEGER;
  return runners.sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      last(a.missing) - last(b.missing) ||
      last(a.extra) - last(b.extra) ||
      last(a.start_diff_ms) - last(b.start_diff_ms) ||
      a.name.localeCompare(b.name, 'sv')
  );
}
