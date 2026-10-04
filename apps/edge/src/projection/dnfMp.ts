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
//   - Elapsed time = absolute finish − start, where start is the card's
//     start punch, else the drawn start (startMs below, 02.1-14 Task 11);
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
import { cardClockToEpochMs } from './halfDayClockMath.ts';

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
  /** Class ignores start punches ("Ej startstämpling", MeOS IgnoreStart). */
  ignoreStartPunch: boolean;
}

export interface StatusResult {
  status: 'OK' | 'MP' | 'DNF';
  missing_codes: number[];
  extra_codes: number[];
  out_of_order_codes: number[];
  elapsed_time_ms: number | null;
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
 * appear in order as a subsequence of `input.punches` (control-station
 * punches only — Phase 0 decoder separates start/finish/check at the
 * storage→raceResult boundary). Extra punches never cause MP.
 */
export function detectStatus(
  input: DetectInput,
  expectedControlCodes: readonly number[]
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

  // Gate 2 (02.1-14 Task 2): the course controls must appear in order as a
  // subsequence of the punches — the orienteering rule MeOS applies. Walk
  // the expected codes; each is matched greedily at the first punch after
  // the previous match. Repeated controls (butterflies) simply match again
  // later in the punch list.
  //   - missing:      expected codes with no punch after the previous match
  //   - out_of_order: missing codes that were punched, but only before the
  //                   previous match (informational; also in missing)
  //   - extra:        punches not used by the match (informational — stray
  //                   controls, double punches, out-of-order punches)
  // Only missing codes cause MP.
  const actual = input.punches.map((p) => p.code);
  const used = new Array<boolean>(actual.length).fill(false);
  const missing: number[] = [];
  const outOfOrder: number[] = [];
  let next = 0;
  for (const code of expectedControlCodes) {
    const idx = actual.indexOf(code, next);
    if (idx === -1) {
      missing.push(code);
      if (actual.includes(code)) outOfOrder.push(code);
      continue;
    }
    used[idx] = true;
    next = idx + 1;
  }
  const extra = actual.filter((_, i) => !used[i]);

  const status: 'OK' | 'MP' = missing.length === 0 ? 'OK' : 'MP';
  return {
    status,
    missing_codes: missing,
    extra_codes: extra,
    out_of_order_codes: outOfOrder,
    elapsed_time_ms: elapsed,
  };
}

/** The start a running time is measured from (epoch ms), as in MeOS
 * (02.1-14 Task 11): the card's start punch replaces the drawn start
 * (oRunner.cpp:1331-1344), except in a class that ignores start punches when
 * the runner has a drawn start (oRunner.cpp:1226-1227). Null without either. */
export function startMs(
  input: Pick<DetectInput, 'start' | 'cardType' | 'readAtMs' | 'drawnStartMs' | 'ignoreStartPunch'>
): number | null {
  if (input.ignoreStartPunch && input.drawnStartMs !== null) return input.drawnStartMs;
  if (input.start === null) return input.drawnStartMs;
  return cardClockToEpochMs(input.start, input.cardType, input.readAtMs);
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
