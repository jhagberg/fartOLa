// Authored for fartola. Not ported from upstream.
//
// Entry fees for runners fartOLa registers itself (SOFT TR 4.12.6, TR
// 4.12.4). Pre-entered runners pay what Eventor decided; fartOLa does not
// recompute that. A late or walk-up entry pays the class fee plus the
// organiser's surcharge, a percentage of the fee (as Eventor models it),
// capped per class type:
//
//   TR 4.12.6               efteranmälan   direktanmälan (tävlingsdagen)
//   åldersklass, vuxen          50 %           100 %
//   åldersklass, ungdom         50 %            50 %
//   öppen klass, vuxen          50 %            50 %
//   öppen klass, ungdom          0 %             0 %
//
// Ungdom is 16 years and younger (TR 3.4.6), counted by birth year as
// Eventor does (FromDateOfBirth 1 January). In an age class the class
// decides; in an open class the runner's age does (TR 4.12.1).
// Inskolning counts as a youth open class: it is meant for children (TR
// 3.4.8), so it never carries a surcharge. A class without a kind gets no
// surcharge: fartOLa never charges more than it can show is allowed.
// Amounts are whole kronor; the surcharge rounds down so it never passes
// the cap.

import type { ClassKind } from './dtos.ts';

/** 'late': registered before the competition day; 'walkup': on the day. */
export type EntryTiming = 'late' | 'walkup';

const AGE_ADULT: ReadonlySet<ClassKind> = new Set(['elit', 'junior', 'senior', 'veteran']);

/** The highest surcharge SOFT allows, in percent of the class fee. */
export function surchargeCapPct(
  kind: ClassKind | null,
  youthRunner: boolean,
  timing: EntryTiming
): number {
  if (kind === null || kind === 'inskolning') return 0;
  if (kind === 'oppen') return youthRunner ? 0 : 50;
  if (kind === 'ungdom') return 50;
  return AGE_ADULT.has(kind) && timing === 'walkup' ? 100 : 50;
}

/** SOFT's youth age: 16 or younger in the competition's year. */
export function isYouthByBirthYear(birthYear: number, competitionDate: string): boolean {
  return Number(competitionDate.slice(0, 4)) - birthYear <= 16;
}

export interface ClassFees {
  classKind: ClassKind | null;
  /** The class fee in kronor; null = not set (no fee). */
  entryFee: number | null;
  /** A lower fee for youth in an open class; null = same as entryFee. */
  youthEntryFee: number | null;
  /** The organiser's surcharge in percent; null = none. */
  lateFeePct: number | null;
}

export interface EntryFee {
  /** The class fee charged, in kronor. */
  entry: number;
  /** The surcharge charged, in kronor, after the SOFT cap. */
  late: number;
  /** True when the cap lowered the organiser's surcharge. */
  capped: boolean;
}

/** Youth pay the youth fee: everyone in inskolning, youth in an open
 * class. */
export const paysYouthFee = (kind: ClassKind | null, youthRunner: boolean): boolean =>
  kind === 'inskolning' || (kind === 'oppen' && youthRunner);

/** The fee for a late or walk-up entry. `youthRunner` matters only in open
 * classes. */
export function entryFeeFor(c: ClassFees, youthRunner: boolean, timing: EntryTiming): EntryFee {
  const youth = paysYouthFee(c.classKind, youthRunner);
  const entry = (youth ? (c.youthEntryFee ?? c.entryFee) : c.entryFee) ?? 0;
  const wanted = c.lateFeePct ?? 0;
  const pct = Math.min(wanted, surchargeCapPct(c.classKind, youth, timing));
  return { entry, late: Math.floor((entry * pct) / 100), capped: pct < wanted };
}
