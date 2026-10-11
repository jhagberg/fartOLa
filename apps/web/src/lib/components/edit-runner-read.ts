// Authored for fartola. Not ported from upstream.
//
// What the edit dialog shows of a runner's read (start, finish, punches),
// turned from the corrections payload (GET …/corrections) into a view
// model. Display only: status, times and the late start come from the edge.

import { formatClockTime } from '@fartola/shared-types';
import type { ClassDTO, CourseDTO } from '@fartola/shared-types';
import type { CorrectionsDTO } from '#lib/api/client.ts';
import { classifyPunches, formatElapsed, rawPunchesToReceipt } from '#lib/screens/readout-types.ts';
import type { ReceiptPunch } from './receipt-templates/types.ts';

export interface EditRunnerRead {
  /** No read-out in this competition: say so, never "unavailable". */
  neverRead: boolean;
  readAt: string | null;
  readCount: number;
  start: {
    drawn: string | null;
    punch: string | null;
    /** Which one the running time starts from; null without a start. */
    from: 'drawn' | 'punch' | null;
  };
  /** "3:12" when the start punch is more than 60 s late; else null. */
  lateStart: string | null;
  finish: { time: string; byHand: boolean } | null;
  status: CorrectionsDTO['status'];
  elapsed: string | null;
  /** Controls in course order (course-shaped when the class has a course). */
  punches: ReceiptPunch[];
  /** False without a course: tiles are plain punches, none "saknas". */
  verdict: boolean;
  manualPunches: Array<{ code: number; reason: string }>;
  /** Time addition in whole minutes, already in `elapsed`; null for none. */
  timeAddition: { min: number; reason: string } | null;
}

/** The course the class runs: classes.course_id, else the course that
 * points at the class (as the edge reads it). Empty without a course. */
export function courseCodes(
  cls: Pick<ClassDTO, 'id' | 'course_id'> | undefined,
  courses: CourseDTO[]
): number[] {
  if (!cls) return [];
  const course =
    courses.find((c) => c.id === cls.course_id) ?? courses.find((c) => c.class_id === cls.id);
  if (!course) return [];
  return [...course.controls].sort((a, b) => a.order_idx - b.order_idx).map((c) => c.control_code);
}

export function toEditRunnerRead(
  c: CorrectionsDTO,
  ctx: {
    clockOffsetMin: number;
    expectedCodes: number[];
    voidedCodes: number[];
    noTiming: boolean;
  }
): EditRunnerRead {
  const read = c.latest_read;
  const clock = (ms: number): string => formatClockTime(ms, ctx.clockOffsetMin);
  const tiles = read
    ? classifyPunches(
        rawPunchesToReceipt(
          read.punches,
          read.start?.seconds_in_half_day ?? null,
          read.finish?.seconds_in_half_day ?? null,
          ctx.expectedCodes
        ),
        ctx.expectedCodes,
        ctx.voidedCodes,
        c.manual_punches.map((p) => p.control_code)
      )
    : [];
  return {
    neverRead: read === null && c.read_count === 0,
    readAt: read === null ? null : clock(read.read_at_ms),
    readCount: c.read_count,
    start: {
      drawn: c.drawn_start_ms === null ? null : clock(c.drawn_start_ms),
      punch: read?.start_ms == null ? null : clock(read.start_ms),
      from: c.start_source,
    },
    lateStart: c.late_start_ms === null ? null : formatElapsed(c.late_start_ms),
    finish:
      c.manual_finish_ms !== null
        ? { time: clock(c.manual_finish_ms), byHand: true }
        : read?.finish_ms != null
          ? { time: clock(read.finish_ms), byHand: false }
          : null,
    status: c.status,
    elapsed: ctx.noTiming
      ? null
      : c.elapsed_time_ms === null
        ? null
        : formatElapsed(c.elapsed_time_ms),
    punches: ctx.noTiming ? tiles.map((p) => ({ ...p, split: '—', time: '—' })) : tiles,
    verdict: ctx.expectedCodes.length > 0,
    manualPunches: c.manual_punches.map((p) => ({ code: p.control_code, reason: p.reason })),
    timeAddition:
      c.time_addition_min > 0
        ? { min: c.time_addition_min, reason: c.time_addition_reason ?? '' }
        : null,
  };
}
