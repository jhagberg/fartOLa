// Authored for fartola. Not ported from upstream.
//
// Pure reducer over the event log → CompetitionState. Per codex review
// C-H2: card_read payload carries top-level start/finish/check/clear
// HalfDayClock fields. The reducer reads payload.start + payload.finish
// for elapsed-time and DNF detection — NOT from punches[] with magic
// control codes.
//
// Idempotency (REQ-EVT-004): two runs over the same event log produce
// structurally identical CompetitionState. Events are sorted by
// (event_time_ms, local_seq) before the walk so shuffled inputs converge.
//
// Manual-override semantics: once a manual_status_set event is observed
// for a competitor (or the legacy manual_dnf from Phase-1 logs), subsequent
// card_read events do NOT overwrite the status. `clear_manual_status`
// (legacy alias: `un_dnf`) clears the override and re-applies
// dnfMp.detectStatus against the most recent card_read state.
//
// Phase 2.0 extension: manual_status_set lets the operator assert any of
// DNF/DNS/DQ/CANCEL/MAX. The legacy manual_dnf event is equivalent to
// manual_status_set{status:'DNF'} — both write the same view.manual_status
// field so mixed-vintage event logs project deterministically.
//
// Cross-competition isolation (T-CROSS-COMP-LEAK): the loop short-
// circuits any event whose `competitionId` doesn't match
// `input.competition_id`. A single events table backs multiple
// competitions; the reducer is per-competition.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-11 D-12
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Live results auto-update"
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2
//   (payload.start / payload.finish read directly; finish=null → DNF;
//    elapsed from HalfDayClock pair)
// - REQ-EVT-003 (derived state by reducers)
// - REQ-EVT-004 (deterministic + idempotent)
// - REQ-EVT-CMP-005 (auto-attach card → competitor)
// - REQ-EVT-CMP-006 (DNF/MP from event log)

import type { NdjsonPunch, HalfDayClock } from '@fartola/sportident';
import type { Event, Competitor, Course, Class } from '../db/types.ts';
import type { EventPayload } from '../db/schema.ts';
import { detectStatus } from './dnfMp.ts';
import { buildCardIndex } from './matching.ts';
import type { CompetitionState, CompetitorView, ResultView } from './types.ts';

/** Course extended with the in-order list of expected control codes. Plan 08
 * (projection store) loads courses via `course_controls` join + `controls`
 * lookup and produces this `course + control_codes` shape; the reducer
 * never touches the raw join. */
export type CourseWithControlCodes = Course & { control_codes: readonly number[] };

export interface ReduceInput {
  competition_id: string;
  /** Phase 2.1 (2026-05-18) — race-phase gate. The loader passes the
   * value of competitions.race_started_at_ms:
   *   - `null`      → pre-race phase. card_reads are identity scans
   *                   only — never run detectStatus.
   *   - `number`    → race has started at that ms-epoch. card_reads at
   *                   or after this timestamp run through detectStatus
   *                   normally; reads before stay PEND (audit-trail
   *                   only, e.g. cards with stale punches from another
   *                   race scanned at the registration desk).
   *   - `undefined` → omitted. Treated as "no phase gate" — every
   *                   card_read scores. This is the back-compat branch
   *                   for Phase-1 reducer tests that pre-date the
   *                   phase concept; production callers always set it
   *                   explicitly via the loader. */
  race_started_at_ms?: number | null;
  events: readonly Event[];
  competitors: readonly Competitor[];
  classes: readonly Class[];
  courses: readonly CourseWithControlCodes[];
  /** Phase 2.1 (D-15): replacement controls map, keyed by courseId →
   * (expectedControlCode → [alternativeCodes]).
   * When a punch matches an alternative code for the expected position,
   * it counts as a match. Lookup is a single-level Map.get — no chaining,
   * no recursion, no cycle risk. Omit / leave undefined for no replacements. */
  replacementControls?: ReadonlyMap<string, ReadonlyMap<number, number[]>>;
}

// Sort order on results tables: finished runners first (OK → MP), then runners
// who failed to complete (DNF), then operator rule states (DQ — more severe
// assertion than the time-domain MAX), then time-cap exceeded (MAX), then
// runners absent on race day (DNS), then pre-race withdrawals (CANCEL), then
// runners with no read yet (PEND). DQ-before-MAX matches Eventor + the IOF
// v3 convention where Disqualified outranks OverTime; broad shape (finished
// > unfinished > absent) is universal across orienteering software.
const STATUS_ORDER: Record<CompetitorView['status'], number> = {
  OK: 0,
  MP: 1,
  DNF: 2,
  DQ: 3,
  MAX: 4,
  DNS: 5,
  CANCEL: 6,
  PEND: 7,
};

/**
 * Pure reducer: events + course + competitors → CompetitionState.
 *
 * Does NOT touch the DB, does NOT broadcast, does NOT mutate input. Calls
 * `dnfMp.detectStatus` per card_read for OK/MP/DNF + elapsed time, and
 * `matching.matchCardToCompetitor` for card-to-competitor binding.
 */
export function reduce(input: ReduceInput): CompetitionState {
  // Sort events deterministically. Shuffled input → identical output.
  const sortedEvents = [...input.events].sort(
    (a, b) => a.eventTimeMs - b.eventTimeMs || a.localSeq - b.localSeq
  );

  // Per-competition slice of competitors so cross-competition leakage cannot
  // happen through matching (T-CROSS-COMP-LEAK).
  const competitorsByCompetition = input.competitors.filter(
    (c) => c.competitionId === input.competition_id
  );

  // Plan 09: build the cardNumber → Competitor index ONCE per reduce() call
  // so the card_read case below is O(1) instead of O(n) linear scan. For
  // 1000 events × 40 competitors this drops the inner work from ~40k
  // comparisons to ~1000 Map.get() calls. Externally-visible behavior is
  // identical to the plan-07 linear scan — same fixture, same output.
  const cardIndex = buildCardIndex(competitorsByCompetition);

  // Course lookup by class_id for fast per-event MP detection. A course may
  // legitimately have classId=null during XML import; those competitors get
  // an empty expected list and thus MP / OK based purely on punches presence.
  const courseByClass = new Map<string, CourseWithControlCodes>();
  for (const c of input.courses) {
    if (c.classId !== null) courseByClass.set(c.classId, c);
  }

  // Phase 2.1 (D-08): class max-time lookup by class_id.
  const maxTimeByClass = new Map<string, number>();
  for (const cls of input.classes) {
    if (cls.maxTimeSec !== null && cls.maxTimeSec !== undefined) {
      maxTimeByClass.set(cls.id, cls.maxTimeSec);
    }
  }

  // Seed competitor views (all PEND until a card_read or manual_dnf lands).
  const competitorViews = new Map<string, CompetitorView>();
  for (const c of competitorsByCompetition) {
    competitorViews.set(c.id, {
      id: c.id,
      name: c.name,
      club: c.club,
      class_id: c.classId,
      card_number: c.cardNumber,
      status: 'PEND',
      card_read_history: [],
      latest_punches: [],
      latest_start: null,
      latest_finish: null,
      missing_codes: [],
      extra_codes: [],
      out_of_order_codes: [],
      elapsed_time_ms: null,
      manual_dnf_reason: null,
      manual_status: null,
      voided_legs: [],
      start_time_ms: c.startTimeMs,
    });
  }
  const pendingUnknownCards = new Set<number>();
  let lastEventSeq = 0;
  // Phase 2.1 (D-16): track leg_voided max_seconds caps per competitor.
  // Maps competitorId → (controlCode → maxSeconds | null).
  const voidedLegCapsByCompetitor = new Map<string, Map<number, number | null>>();
  // Phase 2.1 race-phase gate. Seeded from the loader (competitions.
  // race_started_at_ms), but a replayed `race_started` event below can
  // re-seed this mid-walk if the column got out of sync. Three states:
  //   - undefined: caller omitted the field (Phase-1 test fixture) →
  //                gate is OFF; every card_read scores.
  //   - null:      pre-race phase → card_reads are identity scans only.
  //   - number:    race started at this ms-epoch → card_reads at/after
  //                this stamp score; earlier ones stay PEND.
  let raceStartedAtMs: number | null | undefined = input.race_started_at_ms;

  for (const e of sortedEvents) {
    if (e.competitionId !== input.competition_id) continue;
    lastEventSeq = Math.max(lastEventSeq, e.localSeq);

    const payload = e.payload as EventPayload;
    switch (payload.event_type) {
      case 'card_read': {
        const competitor = cardIndex.get(payload.card_number) ?? null;
        if (competitor === null) {
          pendingUnknownCards.add(payload.card_number);
          break;
        }
        const view = competitorViews.get(competitor.id);
        if (view === undefined) break;
        view.card_read_history.push({
          event_time_ms: e.eventTimeMs,
          card_number: payload.card_number,
          punches: payload.punches,
          start: payload.start,
          finish: payload.finish,
        });
        view.latest_punches = payload.punches;
        view.latest_start = payload.start;
        view.latest_finish = payload.finish;
        // Phase 2.1 race-phase gate: card_reads from before the race
        // started are identity scans (e.g. registration-desk lookup with
        // a card that still has punches from a previous race). Append
        // them to history so the audit trail stays complete, but DON'T
        // run detectStatus — the runner stays PEND. Manual overrides
        // applied later still win in the same way. `undefined` here
        // means the caller (Phase-1 tests) opted out of the gate.
        const inRacePhase =
          raceStartedAtMs === undefined ||
          (raceStartedAtMs !== null && e.eventTimeMs >= raceStartedAtMs);
        // Manual override wins: don't overwrite status/elapsed when an
        // operator-asserted state (DNF/DNS/DQ/CANCEL/MAX) is in force.
        if (view.manual_status === null && inRacePhase) {
          const course = courseByClass.get(competitor.classId);
          const expected = course?.control_codes ?? [];
          // Phase 2.1 (D-15): if replacement controls exist for this course,
          // rewrite the expected list for positions where the punched code is
          // a valid alternative. Lookup is single-level only — no chaining.
          const courseReplacements =
            course && input.replacementControls
              ? input.replacementControls.get(course.id)
              : undefined;
          const afterReplacements = courseReplacements
            ? applyReplacements(expected, payload.punches, courseReplacements)
            : expected;
          const resolvedExpected = filterVoidedLegs(afterReplacements, view.voided_legs);
          const detected = detectStatus(
            { start: payload.start, finish: payload.finish, punches: payload.punches },
            resolvedExpected
          );
          view.status = detected.status;
          view.missing_codes = detected.missing_codes;
          view.extra_codes = detected.extra_codes;
          view.out_of_order_codes = detected.out_of_order_codes;
          view.elapsed_time_ms = detected.elapsed_time_ms;
          // Phase 2.1 (D-08): MAX auto-compute — if the competitor finished OK
          // (or MP, though MP never has elapsed) and their class has a time cap,
          // promote to MAX when elapsed exceeds the cap.
          const maxTimeSec = maxTimeByClass.get(competitor.classId);
          if (
            maxTimeSec !== undefined &&
            view.elapsed_time_ms !== null &&
            view.elapsed_time_ms / 1000 > maxTimeSec
          ) {
            view.status = 'MAX';
          }
        }
        break;
      }
      case 'card_bound': {
        // Once an operator binds a card via walk-up, drop it from the
        // pending set so the modal closes.
        pendingUnknownCards.delete(payload.card_number);
        break;
      }
      case 'race_started': {
        // Phase 2.1: flip the in-pass race-phase gate so subsequent
        // card_read events in this same reduce() pass score. The DB
        // column is the durable source of truth (set by the route);
        // this event arm keeps the reducer correct under pure replay
        // when the column happens to be empty (test fixtures that seed
        // events but not the column). Earliest-wins: if a duplicate
        // race_started event lands, the first one keeps the column.
        if (
          raceStartedAtMs === undefined ||
          raceStartedAtMs === null ||
          payload.started_at_ms < raceStartedAtMs
        ) {
          raceStartedAtMs = payload.started_at_ms;
        }
        break;
      }
      case 'race_reset': {
        // Phase 2.1: rollback. Returns the projection to pre-race phase
        // so subsequent card_reads in this pass stop scoring. The DB
        // column is the durable source of truth; this arm keeps replay
        // correct when the events table holds a started→reset pair but
        // the cached column is stale. We set to `null` (pre-race) not
        // `undefined` (gate-off) — once a race_started has been recorded,
        // the gate stays meaningful.
        raceStartedAtMs = null;
        // Un-score any auto-detected statuses already applied in this
        // pass. Manual overrides survive (the operator's assertion is
        // independent of the race-phase gate). card_read_history stays
        // intact as an audit trail.
        for (const v of competitorViews.values()) {
          if (v.manual_status === null) {
            v.status = 'PEND';
            v.missing_codes = [];
            v.extra_codes = [];
            v.out_of_order_codes = [];
            v.elapsed_time_ms = null;
          }
        }
        break;
      }
      case 'manual_dnf': {
        // Legacy event — pre-Phase-2.0 logs only carry this. Equivalent to
        // manual_status_set{status:'DNF'}; both write the same view fields
        // so the projection of a mixed-vintage log is identical.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          view.status = 'DNF';
          view.manual_status = 'DNF';
          view.manual_dnf_reason = payload.reason;
        }
        break;
      }
      case 'manual_status_set': {
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          view.status = payload.status;
          view.manual_status = payload.status;
          view.manual_dnf_reason = payload.reason;
          // Operator-asserted absence/withdrawal: clear computed split fields
          // so the receipt/UI doesn't show stale punches from a prior read
          // that was then overridden to DNS/CANCEL. DNF/MAX/DQ keep the punch
          // history because the runner did at least attempt the course.
          //
          // DQ: also zero punch fields to prevent contamination. The runner is
          // disqualified — stale punch analysis from the prior card_read is
          // misleading on the receipt / readout card (02-11-MAX-AUTOCOMPUTE-TODO
          // MEDIUM: "DQ keeps punch fields after contaminated read").
          if (payload.status === 'DNS' || payload.status === 'CANCEL') {
            view.missing_codes = [];
            view.extra_codes = [];
            view.out_of_order_codes = [];
            view.elapsed_time_ms = null;
          } else if (payload.status === 'DQ') {
            view.missing_codes = [];
            view.extra_codes = [];
            view.out_of_order_codes = [];
            view.latest_punches = [];
            view.elapsed_time_ms = null;
          }
        }
        break;
      }
      case 'un_dnf':
      case 'clear_manual_status': {
        // Both event types do the same thing: clear the override and re-derive
        // from the latest card_read. un_dnf is the Phase-1 alias kept for
        // back-compat with existing event logs and tests.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          view.manual_dnf_reason = null;
          view.manual_status = null;
          // Phase 2.1: If DQ zeroed latest_punches for contamination
          // prevention, restore from card_read_history so re-detection works.
          const latestRead = view.card_read_history[view.card_read_history.length - 1];
          if (
            view.latest_punches.length === 0 &&
            latestRead !== undefined &&
            latestRead.punches.length > 0
          ) {
            view.latest_punches = [...latestRead.punches];
          }
          const competitor = competitorsByCompetition.find((c) => c.id === payload.competitor_id);
          const course = competitor ? courseByClass.get(competitor.classId) : undefined;
          const expected = course?.control_codes ?? [];
          if (
            view.latest_punches.length > 0 ||
            view.latest_finish !== null ||
            view.latest_start !== null
          ) {
            const courseReplacements =
              course && input.replacementControls
                ? input.replacementControls.get(course.id)
                : undefined;
            const afterReplacements = courseReplacements
              ? applyReplacements(expected, view.latest_punches, courseReplacements)
              : expected;
            const resolvedExpected = filterVoidedLegs(afterReplacements, view.voided_legs);
            const detected = detectStatus(
              {
                start: view.latest_start,
                finish: view.latest_finish,
                punches: view.latest_punches,
              },
              resolvedExpected
            );
            view.status = detected.status;
            view.missing_codes = detected.missing_codes;
            view.extra_codes = detected.extra_codes;
            view.out_of_order_codes = detected.out_of_order_codes;
            view.elapsed_time_ms = detected.elapsed_time_ms;
            // Re-apply MAX auto-compute gate after clearing manual override.
            const maxTimeSec = competitor ? maxTimeByClass.get(competitor.classId) : undefined;
            if (
              maxTimeSec !== undefined &&
              view.elapsed_time_ms !== null &&
              view.elapsed_time_ms / 1000 > maxTimeSec
            ) {
              view.status = 'MAX';
            }
          } else {
            view.status = 'PEND';
            view.missing_codes = [];
            view.extra_codes = [];
            view.out_of_order_codes = [];
            view.elapsed_time_ms = null;
          }
        }
        break;
      }
      case 'leg_voided': {
        // Phase 2.1 (D-16): add control_code to view.voided_legs.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          if (!view.voided_legs.includes(payload.control_code)) {
            view.voided_legs = [...view.voided_legs, payload.control_code].sort((a, b) => a - b);
          }
          // Track max_seconds cap for this voided leg.
          let caps = voidedLegCapsByCompetitor.get(payload.competitor_id);
          if (caps === undefined) {
            caps = new Map();
            voidedLegCapsByCompetitor.set(payload.competitor_id, caps);
          }
          caps.set(payload.control_code, payload.max_seconds);
        }
        break;
      }
      case 'leg_unvoided': {
        // Phase 2.1 (D-16): remove control_code from view.voided_legs.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          view.voided_legs = view.voided_legs.filter((c) => c !== payload.control_code);
          const caps = voidedLegCapsByCompetitor.get(payload.competitor_id);
          if (caps !== undefined) caps.delete(payload.control_code);
        }
        break;
      }
      // card_inserted, card_removed, frame_error, connection_changed,
      // consent_confirmed do not change the projection state. consent_confirmed
      // flips a competitor's consent_status column (mutated outside the reducer
      // by plan 14 walk-up + plan 17 PII scrub); the projection only cares
      // about punches + DNF.
      default:
        break;
    }
  }

  // Phase 2.1 (D-16): post-pass voided-leg elapsed recomputation.
  // We defer this to after the event loop so that leg_voided events that
  // arrive after card_read events still affect the elapsed time (event order
  // within the sorted log should not change the projection of derived state).
  for (const [competitorId, caps] of voidedLegCapsByCompetitor) {
    const view = competitorViews.get(competitorId);
    if (view === undefined || view.elapsed_time_ms === null) continue;
    if (view.voided_legs.length === 0) continue;
    // Re-derive elapsed from the latest card_read history entry.
    const latestRead = view.card_read_history[view.card_read_history.length - 1];
    if (latestRead === undefined) continue;
    // Start from the raw detected elapsed (before any voided-leg subtraction).
    // We need the original detectStatus elapsed, not an already-adjusted one.
    // Re-detect from the latest read's punches and timestamps.
    const competitor = competitorsByCompetition.find((c) => c.id === competitorId);
    const course = competitor ? courseByClass.get(competitor.classId) : undefined;
    const expected = course?.control_codes ?? [];
    const courseReplacements =
      course && input.replacementControls ? input.replacementControls.get(course.id) : undefined;
    const afterReplacements = courseReplacements
      ? applyReplacements(expected, latestRead.punches, courseReplacements)
      : expected;
    const resolvedExpected = filterVoidedLegs(afterReplacements, view.voided_legs);
    const detected = detectStatus(
      { start: latestRead.start, finish: latestRead.finish, punches: latestRead.punches },
      resolvedExpected
    );
    // Post-pass also updates status to reflect voided legs (MP→OK transition).
    if (view.manual_status === null) {
      view.status = detected.status;
      view.missing_codes = detected.missing_codes;
      view.extra_codes = detected.extra_codes;
      view.out_of_order_codes = detected.out_of_order_codes;
    }
    if (detected.elapsed_time_ms === null) continue;
    const adjustedElapsed = computeVoidedElapsed(
      detected.elapsed_time_ms,
      view.voided_legs,
      latestRead.punches,
      latestRead.start,
      caps
    );
    view.elapsed_time_ms = adjustedElapsed;
    // Re-apply MAX gate after voided adjustment.
    if (view.manual_status === null && competitor !== undefined) {
      const maxTimeSec = maxTimeByClass.get(competitor.classId);
      if (maxTimeSec !== undefined && adjustedElapsed / 1000 > maxTimeSec) {
        view.status = 'MAX';
      } else if (view.status === 'MAX') {
        // Was MAX from the gate, now under cap — revert to detected status.
        view.status = detected.status;
      }
    }
  }

  // Build per-class results tables. Sort: OK first (by elapsed asc), then MP,
  // then DNF, then PEND. Ties broken by competitor name.
  const resultsByClass = new Map<string, ResultView[]>();
  for (const cls of input.classes) {
    const inClass: CompetitorView[] = [];
    for (const v of competitorViews.values()) {
      if (v.class_id === cls.id) inClass.push(v);
    }
    inClass.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.elapsed_time_ms ?? Number.MAX_SAFE_INTEGER) -
          (b.elapsed_time_ms ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
    );
    let place = 0;
    let leaderTime: number | null = null;
    const rows: ResultView[] = inClass.map((v) => {
      let p: number | null = null;
      let behind: number | null = null;
      if (v.status === 'OK' && v.elapsed_time_ms !== null) {
        place++;
        p = place;
        if (leaderTime === null) leaderTime = v.elapsed_time_ms;
        behind = v.elapsed_time_ms - leaderTime;
      }
      return {
        competitor_id: v.id,
        name: v.name,
        club: v.club,
        status: v.status,
        elapsed_time_ms: v.elapsed_time_ms,
        place: p,
        behind_leader_ms: behind,
      };
    });
    resultsByClass.set(cls.id, rows);
  }

  return {
    competition_id: input.competition_id,
    competitors: competitorViews,
    results_by_class: resultsByClass,
    pending_unknown_cards: [...pendingUnknownCards].sort((a, b) => a - b),
    last_event_seq: lastEventSeq,
  };
}

// ---------------------------------------------------------------------------
// Phase 2.1 helper functions
// ---------------------------------------------------------------------------

function filterVoidedLegs(expected: readonly number[], voidedLegs: readonly number[]): number[] {
  if (voidedLegs.length === 0) return [...expected];
  return expected.filter((code) => !voidedLegs.includes(code));
}

/**
 * Phase 2.1 (D-15): Apply replacement controls to an expected course sequence.
 *
 * For each position i in `expected`, if the punched code at position i
 * matches one of the replacement codes for expected[i], substitute the
 * expected code so detectStatus sees a match. This is single-level only —
 * no chaining (a replacement of a replacement is never followed).
 *
 * The substitution only fires when the actual punched code is in the
 * alternatives list; otherwise the original expected code is kept
 * (detectStatus will then detect it as MP/mismatch naturally).
 */
function applyReplacements(
  expected: readonly number[],
  punches: readonly NdjsonPunch[],
  replacements: ReadonlyMap<number, number[]>
): number[] {
  return expected.map((code, i) => {
    const alternatives = replacements.get(code);
    if (alternatives === undefined) return code;
    const punchedCode = punches[i]?.code;
    if (punchedCode !== undefined && alternatives.includes(punchedCode)) {
      return punchedCode; // treat punched alternative as if it were the expected code
    }
    return code;
  });
}

/**
 * Phase 2.1 (D-16): Compute elapsed_time_ms after subtracting voided leg durations.
 *
 * For each voided control code, find the leg in the punch sequence:
 *   leg_ms = punch_at_control_ms - punch_at_previous_control_ms
 * where previous control = the punch immediately before in the sequence.
 * If the control is the first punch, leg_ms = punch_ms - start_ms.
 *
 * Subtract min(leg_ms, max_seconds * 1000) from elapsed.
 * The max_seconds cap comes from the leg_voided event payload.
 */
function computeVoidedElapsed(
  elapsedMs: number,
  voidedLegs: readonly number[],
  punches: readonly NdjsonPunch[],
  start: HalfDayClock | null,
  caps: ReadonlyMap<number, number | null>
): number {
  let adjusted = elapsedMs;
  for (const controlCode of voidedLegs) {
    const idx = punches.findIndex((p) => p.code === controlCode);
    if (idx === -1) continue;
    const punch = punches[idx]!;
    // Compute punch time in seconds within the same half-day as the start.
    const punchSec = punch.seconds_in_half_day + punch.half_day * 12 * 3600;
    let prevSec: number | null = null;
    if (idx === 0) {
      // First punch — previous reference is the start punch.
      if (start !== null) {
        prevSec = start.seconds_in_half_day + start.half_day * 12 * 3600;
      }
    } else {
      const prev = punches[idx - 1]!;
      prevSec = prev.seconds_in_half_day + prev.half_day * 12 * 3600;
    }
    if (prevSec === null) continue;
    const legSec = punchSec - prevSec;
    if (legSec <= 0) continue;
    const maxSec = caps.get(controlCode);
    const deductSec = maxSec !== null && maxSec !== undefined ? Math.min(legSec, maxSec) : legSec;
    adjusted -= deductSec * 1000;
  }
  return Math.max(0, adjusted);
}
