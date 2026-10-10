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
  startBeforeFinishMs,
} from '@fartola/shared-types';
import type { CompetitionClock } from './competition-clock.ts';

/** A finish typed by hand as epoch ms, or why not. */
export type FinishEntry = { finishMs: number } | { error: 'invalid' | 'before_start' };

/** 'HH:MM' or 'HH:MM:SS' on the competition clock → the finish (SOFT TR
 * 4.20.6), placed like the card clocks:
 *   - with a start time, the first such time after it (00:10 after a 23:50
 *     start is the next day; more than 12 h after it is before the start);
 *   - else with a read-out, the last such time before it (the runner
 *     finished, then read out), as the card's own times are placed;
 *   - else (card missing, open start) on the competition day. */
export function resolveFinishInput(
  text: string,
  at: { startMs: number | null; readAtMs: number | null },
  clock: CompetitionClock
): FinishEntry {
  const seconds = parseTimeOfDay(text);
  if (seconds === null) return { error: 'invalid' };
  if (at.startMs !== null) {
    const finishMs = finishAfterStartMs(seconds, at.startMs, clock.offsetMin);
    return finishMs === null ? { error: 'before_start' } : { finishMs };
  }
  if (at.readAtMs !== null) {
    const finishMs = startBeforeFinishMs(seconds, at.readAtMs, clock.offsetMin);
    if (finishMs !== null) return { finishMs };
  }
  return { finishMs: clockToEpochMs(clock.date, seconds, clock.offsetMin) };
}

/** The corrections a runner has, as lines for the readout card. */
export interface CorrectionLine {
  key: 'corr.line.finish' | 'corr.line.punch' | 'corr.line.addition';
  vars: Record<string, string>;
}

export function correctionLines(
  row: {
    manual_finish_ms: number | null;
    manual_finish_reason: string | null;
    manual_punches: Array<{ control_code: number; reason: string }>;
    time_addition_min: number;
    time_addition_reason: string | null;
  },
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
  for (const p of row.manual_punches) {
    lines.push({
      key: 'corr.line.punch',
      vars: { code: String(p.control_code), reason: p.reason },
    });
  }
  if (row.time_addition_min > 0) {
    lines.push({
      key: 'corr.line.addition',
      vars: { minutes: String(row.time_addition_min), reason: row.time_addition_reason ?? '' },
    });
  }
  return lines;
}

/** A control code typed by hand, or null when it is not one. */
export function parseControlCode(text: string): number | null {
  const n = Number(text.trim());
  return /^\d+$/.test(text.trim()) && n > 0 ? n : null;
}
