// Authored for fartola. Not ported from upstream.
//
// DNF/MP detection over a card_read payload. Per codex review C-H2
// (revision 2):
//
//   - DNF when payload.finish === null. The prior revision filtered
//     punches[] for FINISH_CODES = {2, 3, 240}; those codes in Phase 0's
//     surface are CONTROL-STATION punches, not finish events. Phase 0
//     emits start/finish as top-level HalfDayClock fields on
//     CardReadEvent (packages/sportident/src/output/ndjson.ts lines
//     84-98). The reducer now reads payload.start and payload.finish
//     directly.
//
//   - The START_CODES / FINISH_CODES / CHECK_CODES filter constants from
//     revision 1 are REMOVED. punches[] from a Phase-0-decoded card_read
//     contains only control-station punches — the decoder layer already
//     separates start/finish/check at the storage→raceResult boundary.
//
//   - Elapsed time = absolute finish − start, where start follows the
//     class's start method (startMs below, 02.1-14 Task 14);
//     card clocks are placed in time by cardClockToEpochMs
//     (halfDayClockMath.ts) relative to the read time (02.1-14 Task 3).
//     Null when there is no finish or no start of either kind.
//
// Per CONTEXT D-12 (punch-only DNF, no time-auto-DNF in Phase 1) and
// UI-SPEC §"Manual DNF override" (manual_dnf wins). The manual override is
// applied by reduce.ts (not here) — this helper only consumes the bare
// payload and emits OK/MP/DNF on its own.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-12
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §"Manual
//   DNF override"
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import type { NdjsonPunch, HalfDayClock } from '@fartola/sportident';
import type { Class } from '../db/types.ts';
import { cardClockToEpochMs } from './halfDayClockMath.ts';

/** 'auto' | 'start_time' | 'start_punch' — classes.start_method. */
export type StartMethod = Class['startMethod'];

export interface DetectInput {
  start: HalfDayClock | null;
  finish: HalfDayClock | null;
  punches: readonly NdjsonPunch[];
  /** card_read payload card_type; 'SI5' has no AM/PM bit (02.1-14 Task 3). */
  cardType: string;
  /** Host time of the read (event_time_ms); anchors the card clock. */
  readAtMs: number;
  /** Drawn start (competitors.start_time_ms, epoch ms); null = open start. */
  drawnStartMs: number | null;
  /** The class's start method (02.1-14 Task 14). */
  startMethod: StartMethod;
}

export interface StatusResult {
  status: 'OK' | 'MP' | 'DNF';
  missing_codes: number[];
  extra_codes: number[];
  out_of_order_codes: number[];
  elapsed_time_ms: number | null;
}

/** Replacement controls (D-15): expected code → codes that also count for it. */
export type ControlAlternatives = ReadonlyMap<number, readonly number[]>;

export interface CourseMatch {
  /** Per expected position, the index of the punch matched to it, or -1. */
  matched: number[];
  missing: number[];
  out_of_order: number[];
  extra: number[];
}

/**
 * Match the course controls in order as a subsequence of the punched codes —
 * the orienteering rule MeOS applies (02.1-14 Task 2). Walk the expected
 * codes; each is matched greedily at the first punch after the previous
 * match whose code is the expected one or one of its replacement controls
 * (D-15, single level — no chaining). Repeated controls (butterflies) simply
 * match again later in the punch list.
 *   - missing:      expected codes with no punch after the previous match
 *   - out_of_order: missing codes that were punched (or replaced), but only
 *                   before the previous match (informational; also in missing)
 *   - extra:        punches not used by the match (informational — stray
 *                   controls, double punches, out-of-order punches)
 * Shared by detectStatus and the voided-leg time (reduce.ts) so both see the
 * same matched punch per course position.
 */
export function matchCourse(
  punchedCodes: readonly number[],
  expectedControlCodes: readonly number[],
  alternatives?: ControlAlternatives
): CourseMatch {
  const used = new Array<boolean>(punchedCodes.length).fill(false);
  const matched: number[] = [];
  const missing: number[] = [];
  const outOfOrder: number[] = [];
  let next = 0;
  for (const code of expectedControlCodes) {
    const alts = alternatives?.get(code);
    const fits = (c: number): boolean => c === code || (alts !== undefined && alts.includes(c));
    let idx = -1;
    for (let i = next; i < punchedCodes.length; i++) {
      if (fits(punchedCodes[i]!)) {
        idx = i;
        break;
      }
    }
    matched.push(idx);
    if (idx === -1) {
      missing.push(code);
      if (punchedCodes.some(fits)) outOfOrder.push(code);
      continue;
    }
    used[idx] = true;
    next = idx + 1;
  }
  const extra = punchedCodes.filter((_, i) => !used[i]);
  return { matched, missing, out_of_order: outOfOrder, extra };
}

/**
 * Classify a single card_read against the expected course controls.
 *
 * Gate 1 (DNF, codex C-H2 LOCKED): `input.finish === null` → status='DNF'
 * regardless of how many punches were collected. A clean run with all
 * controls but no finish stamp is genuinely DNF (operator killed the
 * read before the finish punch, or the cable was yanked mid-read).
 *
 * Gate 2 (OK/MP): `input.finish !== null` → `expectedControlCodes` must
 * appear in order as a subsequence of `input.punches` (matchCourse; control-
 * station punches only — Phase 0 decoder separates start/finish/check at the
 * storage→raceResult boundary). Extra punches never cause MP; only missing
 * codes do.
 */
export function detectStatus(
  input: DetectInput,
  expectedControlCodes: readonly number[],
  alternatives?: ControlAlternatives
): StatusResult {
  const elapsed = elapsedMs(input);

  // Gate 1: no finish stamp → DNF, regardless of punches[] contents.
  if (input.finish === null) {
    return {
      status: 'DNF',
      missing_codes: [...expectedControlCodes],
      extra_codes: input.punches.map((p) => p.code),
      out_of_order_codes: [],
      elapsed_time_ms: null,
    };
  }

  // Gate 2 (02.1-14 Task 2): in-order subsequence match.
  const match = matchCourse(
    input.punches.map((p) => p.code),
    expectedControlCodes,
    alternatives
  );
  return {
    status: match.missing.length === 0 ? 'OK' : 'MP',
    missing_codes: match.missing,
    extra_codes: match.extra,
    out_of_order_codes: match.out_of_order,
    elapsed_time_ms: elapsed,
  };
}

/** The start a running time is measured from (epoch ms), by the class's
 * start method (02.1-14 Task 14). Null when there is none (missing start).
 *   - start_time:  the runner's start time; the punch is ignored. A late
 *                  runner keeps the original start time (SOFT TR 4.18.9
 *                  (2026-07-01)); the secretariat sets a new one for the
 *                  organiser's mistake.
 *   - start_punch: the start punch, else the start time (MeOS,
 *                  oRunner.cpp:1331-1344; SOFT TR 4.18.16 (2026-07-01)).
 *   - auto:        start_time when the runner has a start time, else the
 *                  punch (fri starttid in open classes, SOFT TR 7.4.3
 *                  (2026-07-01)). */
export function startMs(
  input: Pick<DetectInput, 'start' | 'cardType' | 'readAtMs' | 'drawnStartMs' | 'startMethod'>
): number | null {
  const punch =
    input.start === null ? null : cardClockToEpochMs(input.start, input.cardType, input.readAtMs);
  switch (input.startMethod) {
    case 'start_time':
      return input.drawnStartMs;
    case 'start_punch':
      return punch ?? input.drawnStartMs;
    case 'auto':
      return input.drawnStartMs ?? punch;
  }
}

/** Late / early start punch for the jury (02.1-14 Task 14), only where the
 * time runs from the start time (start_time, or auto with a start time):
 * a punch more than 60 s after the start time is a late start (SOFT TR
 * 4.18.9 (2026-07-01), TA "Sen start": original start time applies), a
 * punch before it a possible false start (SOFT TR 8.2.8 (2026-07-01)).
 * Warnings only; the time is not changed. Both in ms, positive. */
export const LATE_START_GRACE_MS = 60_000;
export function startPunchWarning(
  input: Pick<DetectInput, 'start' | 'cardType' | 'readAtMs' | 'drawnStartMs' | 'startMethod'>
): { late_start_ms: number | null; early_start_ms: number | null } {
  const none = { late_start_ms: null, early_start_ms: null };
  if (input.start === null || input.drawnStartMs === null || input.startMethod === 'start_punch') {
    return none;
  }
  const diff = cardClockToEpochMs(input.start, input.cardType, input.readAtMs) - input.drawnStartMs;
  if (diff > LATE_START_GRACE_MS) return { late_start_ms: diff, early_start_ms: null };
  if (diff < 0) return { late_start_ms: null, early_start_ms: -diff };
  return none;
}

/** Running time = finish − start, both absolute (02.1-14 Task 3); start per
 * startMs above. Null without a finish or any start. */
function elapsedMs(input: DetectInput): number | null {
  if (input.finish === null) return null;
  const start = startMs(input);
  if (start === null) return null;
  const elapsed = cardClockToEpochMs(input.finish, input.cardType, input.readAtMs) - start;
  // A finish before the start (wrong day / wrong drawn time) is no time,
  // not a winning negative one.
  return elapsed >= 0 ? elapsed : null;
}
