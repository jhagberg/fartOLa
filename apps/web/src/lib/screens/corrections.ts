// Authored for fartola. Not ported from upstream.
//
// Logic for the secretariat's correction panel (components/
// CorrectionsPanel.svelte) and the corrections line on the readout card:
// a finish typed as a time of day placed on the competition clock, and
// what is corrected, as i18n keys.

import {
  clockToEpochMs,
  finishAfterStartMs,
  formatClockTime,
  parseTimeOfDay,
} from '@fartola/shared-types';
import type { CompetitionClock } from './competition-clock.ts';

/** A finish typed by hand as epoch ms, or why not. */
export type FinishEntry = { finishMs: number } | { error: 'invalid' | 'before_start' };

/** 'HH:MM' or 'HH:MM:SS' on the competition clock → the finish (SOFT TR
 * 4.20.6): the first such time after the runner's start time, so 00:10
 * after a 23:50 start is the next day; more than 12 h after it means the
 * time is before the start. Without a start time, the competition day. */
export function resolveFinishInput(
  text: string,
  startMs: number | null,
  clock: CompetitionClock
): FinishEntry {
  const seconds = parseTimeOfDay(text);
  if (seconds === null) return { error: 'invalid' };
  if (startMs === null) return { finishMs: clockToEpochMs(clock.date, seconds, clock.offsetMin) };
  const finishMs = finishAfterStartMs(seconds, startMs, clock.offsetMin);
  return finishMs === null ? { error: 'before_start' } : { finishMs };
}

/** The corrections a runner has, as lines for the readout card. */
export interface CorrectionLine {
  key: 'corr.line.finish';
  vars: Record<string, string>;
}

export function correctionLines(
  row: { manual_finish_ms: number | null; manual_finish_reason: string | null },
  clockOffsetMin: number | null
): CorrectionLine[] {
  const lines: CorrectionLine[] = [];
  if (row.manual_finish_ms !== null && clockOffsetMin !== null) {
    lines.push({
      key: 'corr.line.finish',
      vars: {
        time: formatClockTime(row.manual_finish_ms, clockOffsetMin),
        reason: row.manual_finish_reason ?? '',
      },
    });
  }
  return lines;
}
