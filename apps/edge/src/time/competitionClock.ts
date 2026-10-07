// Authored for fartola. Not ported from upstream.
//
// Competition clock for apps/edge. The implementation (and the single
// COMPETITION_TZ constant) lives in @fartola/shared-types so the web app
// uses the same code; edge modules import it from here. Timing goes through
// the fixed-offset helpers (ADR-0012); localToEpochMs is civil time, for
// the calendar only (event-code expiry).
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1
// - docs/decisions/0012-competition-time-on-local-wall-clock.md

export {
  COMPETITION_TZ,
  localToEpochMs,
  zoneOffsetMs,
  competitionClockOffsetMin,
  clockToEpochMs,
  epochToClockSeconds,
  formatClockTime,
  formatClockDateTime,
} from '@fartola/shared-types';
