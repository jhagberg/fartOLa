// Authored for fartola. Not ported from upstream.
//
// "Kontroll inför tävlingen": what is still wrong before the first start.
// Modelled on MeOS's "Kör kontroll inför tävlingen..." (TabList.cpp:2933,
// oEvent::generatePreReport in oReport.cpp:341), own code and own rules:
//
//   - no_card: no card bound (SOFT TR 4.18.10, the runner brings a card).
//   - no_start_time: no start time in a class that needs one
//     (classNeedsStartTimes below).
//   - no_club: no club (TR 7.5.4, the start list shows the club). A
//     club-less entry ("Klubblös") is listed too; the operator decides.
//   - no_name: a name under two characters (TR 7.5.1, an entry without a
//     name is not drawn); entry refuses it, an imported row may not.
//   - card_too_small: the class course has more controls than the card has
//     punch slots (si/cardCapacity.ts), e.g. an SI5 on a course over 36.
//   - splits_missing: a soft warning, not a fault: the course fits on the
//     card but has more controls than the card stores with time (an SI5
//     over 30), so the course is checked but splits after 30 are missing.
//   - classes_without_course: a class with runners but no course.
//   - start_punch_not_allowed: a class timed from the start punch that
//     turns out to be a confirmed age class at nivå 1-3, where free start
//     time is not allowed (TR 7.4.2); its start times must be drawn.
//
// MeOS's "Löpare utan klass" and "SI-dubbletter" cannot happen here:
// competitors.class_id is NOT NULL and a card is unique per competition
// (competitors_card_per_comp, 409 card_taken). Its same-course /
// same-first-control start checks belong to start distribution (M3a).
// Withdrawn runners (Återbud) and those already set to Ej start are left
// out: they need neither card nor start time.

import type { ReduceInput } from './reduce.ts';
import type { CompetitionState, CompetitorView } from './types.ts';
import { cardPunchCapacity } from '../si/cardCapacity.ts';
import { kindConfirmed } from '../draw/classKind.ts';

type ClassRow = ReduceInput['classes'][number];
type Level = 'niva1' | 'niva2' | 'niva3' | 'niva4' | 'traning' | null;

export interface PreRaceRunner {
  competitor_id: string;
  name: string;
  club: string | null;
  class_id: string;
  class_name: string;
  card_number: number | null;
}

export interface PreRaceCheck {
  no_card: PreRaceRunner[];
  no_start_time: PreRaceRunner[];
  no_club: PreRaceRunner[];
  no_name: PreRaceRunner[];
  card_too_small: Array<PreRaceRunner & { capacity: number; controls: number }>;
  splits_missing: Array<PreRaceRunner & { timed: number; controls: number }>;
  classes_without_course: Array<{ class_id: string; class_name: string; runners: number }>;
  start_punch_not_allowed: Array<{ class_id: string; class_name: string; runners: number }>;
}

/**
 * Whether every runner in the class must have a start time before the race.
 *   - start_method 'start_punch': no, the time runs from the start punch.
 *   - 'start_time': yes.
 *   - 'auto': yes when the class is drawn (a first start, or any runner
 *     already has a start time); otherwise only in an age class at nivå 1-3,
 *     where free start time is not allowed (TR 7.4.2). Open classes and
 *     inskolning may use free start time (TR 7.4.3). A class whose kind is
 *     not confirmed yet is not flagged.
 */
export function classNeedsStartTimes(
  cls: Pick<ClassRow, 'startMethod' | 'firstStartMs' | 'classKind' | 'classKindSource'>,
  level: Level,
  anyRunnerHasStartTime: boolean
): boolean {
  if (cls.startMethod === 'start_punch') return false;
  if (cls.startMethod === 'start_time') return true;
  if (cls.firstStartMs !== null || anyRunnerHasStartTime) return true;
  return freeStartForbidden(cls, level);
}

/** A confirmed age class (from Eventor or the operator, kindConfirmed) at
 * nivå 1-3, where free start time is not allowed (TR 7.4.2). */
export function freeStartForbidden(
  cls: Pick<ClassRow, 'classKind' | 'classKindSource'>,
  level: Level
): boolean {
  return (
    kindConfirmed(cls) &&
    cls.classKind !== 'oppen' &&
    cls.classKind !== 'inskolning' &&
    (level === 'niva1' || level === 'niva2' || level === 'niva3')
  );
}

export function preRaceCheck(
  input: ReduceInput,
  state: CompetitionState,
  level: Level
): PreRaceCheck {
  const classById = new Map(input.classes.map((c) => [c.id, c]));
  // class.course_id wins; the legacy courses.class_id pointer is the
  // fallback, as in the reducer.
  const courseById = new Map(input.courses.map((c) => [c.id, c]));
  const controlsByClass = new Map<string, number>();
  for (const c of input.courses) {
    if (c.classId !== null) controlsByClass.set(c.classId, c.control_codes.length);
  }
  for (const cls of input.classes) {
    const assigned = cls.courseId ? courseById.get(cls.courseId) : undefined;
    if (assigned) controlsByClass.set(cls.id, assigned.control_codes.length);
  }

  const active = [...state.competitors.values()]
    .filter((v) => v.manual_status !== 'CANCEL' && v.manual_status !== 'DNS')
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const drawn = new Set(active.filter((v) => v.start_time_ms !== null).map((v) => v.class_id));

  const row = (v: CompetitorView): PreRaceRunner => ({
    competitor_id: v.id,
    name: v.name,
    club: v.club,
    class_id: v.class_id,
    class_name: classById.get(v.class_id)?.name ?? '',
    card_number: v.card_number,
  });

  const out: PreRaceCheck = {
    no_card: [],
    no_start_time: [],
    no_club: [],
    no_name: [],
    card_too_small: [],
    splits_missing: [],
    classes_without_course: [],
    start_punch_not_allowed: [],
  };
  const runnersPerClass = new Map<string, number>();
  for (const v of active) {
    runnersPerClass.set(v.class_id, (runnersPerClass.get(v.class_id) ?? 0) + 1);
    const cls = classById.get(v.class_id);
    if (v.card_number === null) out.no_card.push(row(v));
    if (
      v.start_time_ms === null &&
      cls !== undefined &&
      classNeedsStartTimes(cls, level, drawn.has(v.class_id))
    ) {
      out.no_start_time.push(row(v));
    }
    if (v.club === null || v.club.trim() === '') out.no_club.push(row(v));
    if (v.name.trim().length < 2) out.no_name.push(row(v));
    const controls = controlsByClass.get(v.class_id);
    const capacity = v.card_number === null ? null : cardPunchCapacity(v.card_number);
    if (controls !== undefined && capacity !== null && controls > capacity.punches) {
      out.card_too_small.push({ ...row(v), capacity: capacity.punches, controls });
    } else if (controls !== undefined && capacity !== null && controls > capacity.timed) {
      out.splits_missing.push({ ...row(v), timed: capacity.timed, controls });
    }
  }
  for (const cls of [...input.classes].sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
    const runners = runnersPerClass.get(cls.id) ?? 0;
    if (runners > 0 && !controlsByClass.has(cls.id)) {
      out.classes_without_course.push({ class_id: cls.id, class_name: cls.name, runners });
    }
    if (runners > 0 && cls.startMethod === 'start_punch' && freeStartForbidden(cls, level)) {
      out.start_punch_not_allowed.push({ class_id: cls.id, class_name: cls.name, runners });
    }
  }
  return out;
}
