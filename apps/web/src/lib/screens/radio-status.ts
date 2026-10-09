// Authored for fartola. Not ported from upstream.
//
// View helpers for the radio-control status (ROC input). A control's state is
// shown as text plus an icon, never by colour alone (ADR-0016 rule 7).

import { formatClockTime } from '@fartola/shared-types';
import type { RadioControlStatus, RadioStatus } from '@fartola/shared-types';

export interface RadioControlView {
  /** Unique within the list. */
  key: string;
  code: number;
  /** i18n key for the name ("Mål enhet 20", "Start okänd enhet", "Kontroll 78"). */
  nameKey: string;
  /** Percent of ordinary / SIAC cards that came through, for the SIAC warning. */
  otherPct: number | null;
  siacPct: number | null;
  state: RadioControlStatus['state'];
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

/** 3000 → "3 s", 150000 → "3 min" (rounded, sign dropped: a sender clock
 * running ahead is as wrong as one running behind). */
export function formatDelay(ms: number): string {
  const sec = Math.round(Math.abs(ms) / 1000);
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}

export function radioControlView(
  c: RadioControlStatus,
  nowMs: number,
  offsetMin: number
): RadioControlView {
  const pct = (m: number, n: number): number | null => (n === 0 ? null : Math.round((m / n) * 100));
  return {
    key: `${c.role}:${c.unknown_unit ? 'unknown' : c.control_code}`,
    code: c.control_code,
    nameKey: `radio.name.${c.role}${c.unknown_unit ? '.unknown' : ''}`,
    otherPct: pct(c.other_matched, c.other_card_punches),
    siacPct: pct(c.siac_matched, c.siac_card_punches),
    state: c.state,
    labelKey: `radio.state.${c.state}`,
    dateWarnings: c.date_mismatch_count,
    lastHeard: c.last_heard_ms === null ? null : formatClockTime(c.last_heard_ms, offsetMin),
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
    .map((c) => radioControlView(c, status.now_ms, status.clock_offset_min))
    .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, 'sv', { numeric: true }));
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

/** Out-of-order guard for async responses: `begin()` returns a check that is
 * true only while no later `begin()` has happened. A response for the
 * competition the operator has since left is then ignored instead of
 * overwriting (and later being saved into) the current one. */
export function latestOnly(): () => () => boolean {
  let latest = 0;
  return () => {
    const mine = ++latest;
    return () => mine === latest;
  };
}
