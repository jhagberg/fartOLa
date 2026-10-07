// Authored for fartola. Not ported from upstream.
//
// View helpers for the radio-control status (ROC input). A control's state is
// shown as text plus a symbol, never by colour alone (ADR-0016 rule 7).

import { formatLocalTime } from '@fartola/shared-types';
import type { RadioControlStatus, RadioStatus } from '@fartola/shared-types';

export interface RadioControlView {
  code: number;
  state: RadioControlStatus['state'];
  symbol: string;
  /** i18n key for the state label. */
  labelKey: string;
  /** Date warning shown next to the state when > 0 rows have another date. */
  dateWarnings: number;
  /** 'HH:MM:SS' when we last received a radio punch; null = none yet. */
  lastHeard: string | null;
  /** Whole minutes since then. */
  agoMin: number | null;
  /** Median delivery delay over the last window, e.g. "2 s" or "5 min"; null = none. */
  delayText: string | null;
  /** SIAC coverage far below the others'. */
  siacProblem: boolean;
  /** "12/14" read-out punches with a radio match; null when none to compare. */
  coverageText: string | null;
}

const SYMBOL: Record<RadioControlStatus['state'], string> = { ok: '✓', few: '△', silent: '✕' };

/** 3000 → "3 s", 150000 → "3 min" (rounded, sign dropped: a sender clock
 * running ahead is as wrong as one running behind). */
export function formatDelay(ms: number): string {
  const sec = Math.round(Math.abs(ms) / 1000);
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}

export function radioControlView(c: RadioControlStatus, nowMs: number): RadioControlView {
  return {
    code: c.control_code,
    state: c.state,
    symbol: SYMBOL[c.state],
    labelKey: `radio.state.${c.state}`,
    dateWarnings: c.date_mismatch_count,
    lastHeard: c.last_heard_ms === null ? null : formatLocalTime(c.last_heard_ms),
    agoMin:
      c.last_heard_ms === null ? null : Math.max(0, Math.floor((nowMs - c.last_heard_ms) / 60_000)),
    delayText: c.median_delay_ms === null ? null : formatDelay(c.median_delay_ms),
    siacProblem: c.siac_problem,
    coverageText:
      c.window_card_punches === 0 ? null : `${c.window_matched}/${c.window_card_punches}`,
  };
}

/** Worst first (silent, few, date warning only, ok), then by control code. */
export function sortedRadioViews(status: RadioStatus): RadioControlView[] {
  const rank = (v: RadioControlView): number =>
    v.state === 'silent' ? 0 : v.state === 'few' ? 1 : v.dateWarnings > 0 || v.siacProblem ? 2 : 3;
  return status.controls
    .map((c) => radioControlView(c, status.now_ms))
    .sort((a, b) => rank(a) - rank(b) || a.code - b.code);
}

/** "Hämtar stämplingar från ROC-id 4587 och framåt" etc: the baseline in plain words. */
export function baselineKey(status: RadioStatus): { key: string; id: number | null } {
  const id = status.settings.start_id;
  return id === null
    ? { key: 'radio.baseline.pending', id: null }
    : { key: 'radio.baseline.from', id };
}

/** The link to ROC itself: failing polls are shown even with no punches. */
export function rocLinkProblem(status: RadioStatus): string | null {
  return status.poll !== null && status.poll.consecutive_failures > 0
    ? (status.poll.last_error ?? 'error')
    : null;
}
