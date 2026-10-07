// Authored for fartola. Not ported from upstream.
//
// Competition clock for apps/edge. The implementation (and the single
// COMPETITION_TZ constant) lives in @fartola/shared-types so the web app
// uses the same code; edge modules import it from here.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1

export {
  COMPETITION_TZ,
  localToEpochMs,
  epochToLocalSeconds,
  epochToWallClockMs,
  wallClockToEpochMs,
  formatLocalTime,
} from '@fartola/shared-types';
