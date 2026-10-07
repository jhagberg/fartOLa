// Authored for fartola. Not ported from upstream.
//
// Radio watchdog: a pure function over radio punches and read-out card
// punches, all on the competition wall clock (ms, cardClockToWallMs's scale).
// Per radio control:
//   - last heard, punches received;
//   - coverage: of the read-out card punches at the control in the last M
//     minutes, the share with a radio punch from the same card within ±2 s;
//   - silent: nothing heard for N minutes while read-out cards passed the
//     control in the last hour AFTER the last radio punch. (Card punches that
//     the radio did hear before it went quiet say nothing about the link, and
//     a control that is simply quiet late in the day must not alarm.)
//   - few: coverage under the threshold, with at least MIN_SAMPLE card
//     punches in the window (three runners, one missed, is not a trend).
// Only controls heard at least once are radio controls; a control that never
// got through cannot be told from one without a transmitter.
// The date mismatch count is reported next to the state, not as a state.

import type { RadioControlStatus } from '@fartola/shared-types';

export interface RadioPunchIn {
  code: number;
  card: number;
  wallMs: number;
  dateMismatch: boolean;
}

export interface CardPunchIn {
  code: number;
  card: number;
  wallMs: number;
}

export interface WatchdogParams {
  nowWallMs: number;
  /** Coverage window M, minutes. */
  windowMin?: number;
  /** Silence N, minutes. */
  silenceMin?: number;
  /** Coverage under this is "few". */
  coverageThreshold?: number;
  matchToleranceMs?: number;
}

export const WATCHDOG_DEFAULTS = {
  windowMin: 20,
  silenceMin: 10,
  coverageThreshold: 0.8,
  matchToleranceMs: 2000,
  /** Card punches in the window needed before coverage is judged. */
  minSample: 5,
  /** How far back card punches count as "runners are passing". */
  silenceLookbackMin: 60,
} as const;

const MIN_MS = 60_000;

export function evaluateRadioWatchdog(
  radio: RadioPunchIn[],
  card: CardPunchIn[],
  params: WatchdogParams
): RadioControlStatus[] {
  const windowMin = params.windowMin ?? WATCHDOG_DEFAULTS.windowMin;
  const silenceMin = params.silenceMin ?? WATCHDOG_DEFAULTS.silenceMin;
  const threshold = params.coverageThreshold ?? WATCHDOG_DEFAULTS.coverageThreshold;
  const tol = params.matchToleranceMs ?? WATCHDOG_DEFAULTS.matchToleranceMs;
  const { nowWallMs } = params;

  // A card read twice yields the same punches: count each (card, code, time) once.
  const seen = new Set<string>();
  const cardUnique = card.filter((p) => {
    const k = `${p.card}:${p.code}:${p.wallMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const radioByCode = new Map<number, RadioPunchIn[]>();
  for (const p of radio) {
    const list = radioByCode.get(p.code);
    if (list) list.push(p);
    else radioByCode.set(p.code, [p]);
  }

  const out: RadioControlStatus[] = [];
  for (const [code, punches] of radioByCode) {
    const lastHeard = Math.max(...punches.map((p) => p.wallMs));
    const cardHere = cardUnique.filter((p) => p.code === code && p.wallMs <= nowWallMs);

    const inWindow = cardHere.filter((p) => p.wallMs >= nowWallMs - windowMin * MIN_MS);
    const matched = inWindow.filter((c) =>
      punches.some((r) => r.card === c.card && Math.abs(r.wallMs - c.wallMs) <= tol)
    );

    const unheardRecent = cardHere.some(
      (p) =>
        p.wallMs >= nowWallMs - WATCHDOG_DEFAULTS.silenceLookbackMin * MIN_MS &&
        p.wallMs > lastHeard + tol
    );
    const silent = lastHeard < nowWallMs - silenceMin * MIN_MS && unheardRecent;
    const coverage = inWindow.length === 0 ? null : matched.length / inWindow.length;
    const few =
      coverage !== null && inWindow.length >= WATCHDOG_DEFAULTS.minSample && coverage < threshold;

    out.push({
      control_code: code,
      state: silent ? 'silent' : few ? 'few' : 'ok',
      last_heard_ms: lastHeard,
      received: punches.length,
      window_card_punches: inWindow.length,
      window_matched: matched.length,
      coverage,
      date_mismatch_count: punches.filter((p) => p.dateMismatch).length,
    });
  }
  return out.sort((a, b) => a.control_code - b.control_code);
}
