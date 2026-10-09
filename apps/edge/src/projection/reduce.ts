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
// Manual-override semantics: a manual_status_set event (or the legacy
// manual_dnf from Phase-1 logs) wins over the card_reads before it. A
// card_read during the race AFTER it clears any manual status except DQ and
// scores the card, as MeOS evaluateCard does (02.1-14 Task 12).
// `clear_manual_status` (legacy alias: `un_dnf`) clears the override and
// re-applies dnfMp.detectStatus against the most recent card_read state.
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

import type { HalfDayClock } from '@fartola/sportident';
import { softStatus } from '@fartola/shared-types';
import type { Event, Competitor, Course, Class } from '../db/types.ts';
import type { EventPayload } from '../db/schema.ts';
import {
  detectStatus,
  startMs,
  startPunchWarning,
  type ControlAlternatives,
  type StartMethod,
} from './dnfMp.ts';
import { cardClockToEpochMs } from './halfDayClockMath.ts';
import { buildCardIndex } from './matching.ts';
import { withEventStartTimes } from './startTimes.ts';
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
  /** SOFT TR 4.21.1 — the competition's max time in seconds, used for every
   * class (a class's own max_time_sec only applies when this is unset).
   * Omitted / null = none. */
  max_time_sec?: number | null;
  /** ADR-0012 — the competition clock's UTC offset in minutes
   * (competitionClockOffsetMin): card clocks are placed with it. */
  clock_offset_min: number;
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
/** 02.1-14 Task 13: check → start gap used for a missing start when fewer
 * than MIN_CHECK_TO_START_SAMPLES runners have both punches: 1:54, the median
 * of DM 2026 dag 1–2 (424 open starts, 02.1-AUDIT). */
const DEFAULT_CHECK_TO_START_MS = 114_000;
const MIN_CHECK_TO_START_SAMPLES = 10;

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
  // Start times come from start_times_set events (ADR-0003 update 2026-10).
  const competitorsByCompetition = withEventStartTimes(
    input.competitors.filter((c) => c.competitionId === input.competition_id),
    sortedEvents,
    input.competition_id
  );

  // Plan 09: build the cardNumber → Competitor index ONCE per reduce() call
  // so the card_read case below is O(1) instead of O(n) linear scan. For
  // 1000 events × 40 competitors this drops the inner work from ~40k
  // comparisons to ~1000 Map.get() calls. Externally-visible behavior is
  // identical to the plan-07 linear scan — same fixture, same output.
  const cardIndex = buildCardIndex(competitorsByCompetition);

  // 02.1-14 Task 5: course-wide voided controls are dropped from every
  // course before scoring. The final void/unvoid state applies to every read
  // regardless of event order, so it is folded up front.
  const voidedControls = voidedControlCodes(sortedEvents, input.competition_id);
  const courses =
    voidedControls.size === 0
      ? input.courses
      : input.courses.map((c) => ({
          ...c,
          control_codes: c.control_codes.filter((code) => !voidedControls.has(code)),
        }));

  // Course lookup by class_id for fast per-event MP detection. A course may
  // legitimately have classId=null during XML import; those competitors get
  // an empty expected list and thus MP / OK based purely on punches presence.
  const courseByClass = new Map<string, CourseWithControlCodes>();
  for (const c of courses) {
    if (c.classId !== null) courseByClass.set(c.classId, c);
  }
  // 02.1-14 Task 4: classes point at courses (many classes per course).
  // class.courseId wins; the legacy course.classId pointer above is the
  // fallback for classes without one.
  const courseById = new Map(courses.map((c) => [c.id, c]));
  for (const cls of input.classes) {
    const assigned = cls.courseId ? courseById.get(cls.courseId) : undefined;
    if (assigned !== undefined) courseByClass.set(cls.id, assigned);
  }

  // Phase 2.1 (D-08): max time by class_id. SOFT TR 4.21.1: "Maxtiden är
  // densamma för alla klasser" — a competition max time applies to every
  // class; a class's own value is used only when the competition has none
  // (non-sanctioned use).
  const maxTimeByClass = new Map<string, number>();
  for (const cls of input.classes) {
    const maxTimeSec = input.max_time_sec ?? cls.maxTimeSec ?? null;
    if (maxTimeSec !== null) maxTimeByClass.set(cls.id, maxTimeSec);
  }

  // 02.1-14 Task 9: classes without timing.
  const noTimingClasses = new Set(input.classes.filter((c) => c.noTiming).map((c) => c.id));
  // 02.1-14 Task 14: start method per class ('auto' when unset).
  const startMethodByClass = new Map<string, StartMethod>(
    input.classes.map((c) => [c.id, c.startMethod])
  );
  const startMethodOf = (classId: string | undefined): StartMethod =>
    (classId === undefined ? undefined : startMethodByClass.get(classId)) ?? 'auto';
  // Phase 2.1 (D-15): the course's replacement controls, matched by
  // detectStatus at each course position (single level — no chaining).
  const alternativesOf = (
    course: CourseWithControlCodes | undefined
  ): ControlAlternatives | undefined =>
    course === undefined ? undefined : input.replacementControls?.get(course.id);

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
      no_timing: noTimingClasses.has(c.classId),
      missing_start: false,
      suggested_start_ms: null,
      suggested_start_offset_ms: null,
      late_start_ms: null,
      early_start_ms: null,
    });
  }
  const pendingUnknownCards = new Set<number>();
  let lastEventSeq = 0;
  // 02.1-14 Task 13: per competitor, the latest read's check punch (epoch
  // ms, like every card clock — halfDayClockMath) and, for in-race
  // reads with a check and a start punch, check → start.
  const checkMsByCompetitor = new Map<string, number | null>();
  const checkToStartMsByCompetitor = new Map<string, number>();
  // Competitors whose waiver list (voided_legs) changed at any point: the
  // post-pass re-scores exactly these, also when the final list is empty.
  const waiverChanged = new Set<string>();
  // Phase 2.1 race-phase gate. Seeded from the loader (competitions.
  // race_started_at_ms), but a replayed `race_started` event below can
  // re-seed this mid-walk if the column got out of sync. Three states:
  //   - undefined: caller omitted the field (Phase-1 test fixture) →
  //                gate is OFF; every card_read scores.
  //   - null:      pre-race phase → card_reads are identity scans only.
  //   - number:    race started at this ms-epoch → card_reads at/after
  //                this stamp score; earlier ones stay PEND.
  let raceStartedAtMs: number | null | undefined = input.race_started_at_ms;
  /** True when a card_read at `atMs` scores under the current race phase. */
  const inRacePhaseAt = (atMs: number): boolean =>
    raceStartedAtMs === undefined || (raceStartedAtMs !== null && atMs >= raceStartedAtMs);

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
          card_type: payload.card_type,
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
        const inRacePhase = inRacePhaseAt(e.eventTimeMs);
        const cardMs = (c: HalfDayClock | null): number | null =>
          c === null
            ? null
            : cardClockToEpochMs(c, payload.card_type, e.eventTimeMs, input.clock_offset_min);
        const checkMs = cardMs(payload.check);
        const startPunchMs = cardMs(payload.start);
        checkMsByCompetitor.set(competitor.id, checkMs);
        if (inRacePhase && checkMs !== null && startPunchMs !== null) {
          checkToStartMsByCompetitor.set(competitor.id, startPunchMs - checkMs);
        } else {
          checkToStartMsByCompetitor.delete(competitor.id);
        }
        // A read-out during the race re-scores every manual status except DQ,
        // as MeOS evaluateCard does (oRunner.cpp:1621-1630, 02.1-14 Task 12):
        // DNS/CANCEL/MP/DNF become the card's verdict, and MAX is re-derived
        // from the class max time below. A status set after the read wins.
        if (inRacePhase && view.manual_status !== null && view.manual_status !== 'DQ') {
          view.manual_status = null;
          view.manual_dnf_reason = null;
        }
        // Manual override wins: don't overwrite status/elapsed when an
        // operator-asserted state is still in force (DQ, or pre-race).
        if (view.manual_status === null && inRacePhase) {
          const course = courseByClass.get(competitor.classId);
          const expected = course?.control_codes ?? [];
          const resolvedExpected = filterVoidedLegs(expected, view.voided_legs);
          const detected = detectStatus(
            {
              start: payload.start,
              finish: payload.finish,
              punches: payload.punches,
              cardType: payload.card_type,
              readAtMs: e.eventTimeMs,
              drawnStartMs: competitor.startTimeMs,
              clockOffsetMin: input.clock_offset_min,
              startMethod: startMethodOf(competitor.classId),
            },
            resolvedExpected,
            alternativesOf(course)
          );
          view.status = detected.status;
          view.missing_codes = detected.missing_codes;
          view.extra_codes = detected.extra_codes;
          view.out_of_order_codes = detected.out_of_order_codes;
          view.elapsed_time_ms = detected.elapsed_time_ms;
          // Phase 2.1 (D-08): MAX auto-compute — if the competitor finished OK
          // and their class has a time cap, promote to MAX when elapsed
          // exceeds the cap. MP/DNF take precedence over MAX (MeOS: only an
          // OK run becomes over-time; 02.1-14 Task 7).
          const maxTimeSec = maxTimeByClass.get(competitor.classId);
          if (
            view.status === 'OK' &&
            maxTimeSec !== undefined &&
            view.elapsed_time_ms !== null &&
            view.elapsed_time_ms / 1000 > maxTimeSec
          ) {
            view.status = 'MAX';
          }
        }
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
          // Re-detect only a read the race-phase gate lets score; a pre-race
          // identity scan goes back to PEND, as it was before the override.
          if (
            latestRead !== undefined &&
            inRacePhaseAt(latestRead.event_time_ms) &&
            (view.latest_punches.length > 0 ||
              view.latest_finish !== null ||
              view.latest_start !== null)
          ) {
            const resolvedExpected = filterVoidedLegs(expected, view.voided_legs);
            const detected = detectStatus(
              {
                start: view.latest_start,
                finish: view.latest_finish,
                punches: view.latest_punches,
                cardType: latestRead?.card_type ?? '',
                readAtMs: latestRead?.event_time_ms ?? e.eventTimeMs,
                drawnStartMs: competitor?.startTimeMs ?? null,
                clockOffsetMin: input.clock_offset_min,
                startMethod: startMethodOf(competitor?.classId),
              },
              resolvedExpected,
              alternativesOf(course)
            );
            view.status = detected.status;
            view.missing_codes = detected.missing_codes;
            view.extra_codes = detected.extra_codes;
            view.out_of_order_codes = detected.out_of_order_codes;
            view.elapsed_time_ms = detected.elapsed_time_ms;
            // Re-apply MAX auto-compute gate after clearing manual override.
            const maxTimeSec = competitor ? maxTimeByClass.get(competitor.classId) : undefined;
            if (
              view.status === 'OK' &&
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
        // Phase 2.1 (D-16): the control is not required for this runner.
        // The running time is never reduced (SOFT TR 4.20.10); an old
        // event's max_seconds is ignored.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          waiverChanged.add(view.id);
          if (!view.voided_legs.includes(payload.control_code)) {
            view.voided_legs = [...view.voided_legs, payload.control_code].sort((a, b) => a - b);
          }
        }
        break;
      }
      case 'leg_unvoided': {
        // Phase 2.1 (D-16): remove control_code from view.voided_legs.
        const view = competitorViews.get(payload.competitor_id);
        if (view !== undefined) {
          waiverChanged.add(view.id);
          view.voided_legs = view.voided_legs.filter((c) => c !== payload.control_code);
        }
        break;
      }
      // card_bound / card_unbound: reads attach by the competitors' CURRENT
      // card numbers (cardIndex), and every bind writes the row in the same
      // transaction as its event. A bound card's reads, also those made
      // before the bind, attach and never become pending; a bind that is
      // undone or changed leaves its reads unknown again.
      //
      // card_inserted, card_removed, frame_error, connection_changed,
      // consent_confirmed do not change the projection state. consent_confirmed
      // flips a competitor's consent_status column (mutated outside the reducer
      // by plan 14 walk-up + plan 17 PII scrub); the projection only cares
      // about punches + DNF.
      default:
        break;
    }
  }

  // Phase 2.1 (D-16): post-pass voided-leg re-scoring. Deferred to after the
  // event loop so a leg_voided event sorted after the card_read still clears
  // the MP (event order within the sorted log should not change the
  // projection). Only the control verdict changes: the running time stays
  // finish − start for the whole course. SOFT TR 4.20.10 (Regelverk för OL
  // 2026-07-01): "Inga resultat får konstrueras eller rekonstrueras baserat
  // på sträcktiderna." MeOS can drop a leg's time ("Utan tidtagning",
  // oRunner.cpp:1789-1800); fartOLa deliberately does not.
  //
  // Every runner whose waiver list changed is re-scored against the FINAL
  // list, also an empty one: void 31 → read missing 31 → unvoid 31 is MP.
  for (const id of waiverChanged) {
    const view = competitorViews.get(id)!;
    // PEND = no read, or one the race-phase gate kept from scoring.
    if (view.manual_status !== null || view.status === 'PEND') continue;
    const latestRead = view.card_read_history[view.card_read_history.length - 1];
    if (latestRead === undefined) continue;
    const competitor = competitorsByCompetition.find((c) => c.id === view.id);
    const course = competitor ? courseByClass.get(competitor.classId) : undefined;
    const expected = course?.control_codes ?? [];
    const detected = detectStatus(
      {
        start: latestRead.start,
        finish: latestRead.finish,
        punches: latestRead.punches,
        cardType: latestRead.card_type,
        readAtMs: latestRead.event_time_ms,
        drawnStartMs: competitor?.startTimeMs ?? null,
        clockOffsetMin: input.clock_offset_min,
        startMethod: startMethodOf(competitor?.classId),
      },
      filterVoidedLegs(expected, view.voided_legs),
      alternativesOf(course)
    );
    view.status = detected.status;
    view.missing_codes = detected.missing_codes;
    view.extra_codes = detected.extra_codes;
    view.out_of_order_codes = detected.out_of_order_codes;
    view.elapsed_time_ms = detected.elapsed_time_ms;
    const maxTimeSec = competitor ? maxTimeByClass.get(competitor.classId) : undefined;
    if (
      view.status === 'OK' &&
      maxTimeSec !== undefined &&
      view.elapsed_time_ms !== null &&
      view.elapsed_time_ms / 1000 > maxTimeSec
    ) {
      view.status = 'MAX';
    }
  }

  // 02.1-14 Task 13: flag a finished read with no start (per the class's
  // start method, Task 14) and suggest one. "Read so far" = every read in
  // the log at this reduce(), so the suggestion firms up as more runners
  // read out (deterministic). Task 14: also warn for a late / early start
  // punch where the time runs from the start time.
  const gaps = [...checkToStartMsByCompetitor.values()].sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const medianMs =
    gaps.length === 0
      ? null
      : gaps.length % 2 === 1
        ? gaps[mid]!
        : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
  const checkToStartMs =
    gaps.length < MIN_CHECK_TO_START_SAMPLES || medianMs === null
      ? DEFAULT_CHECK_TO_START_MS
      : medianMs;
  for (const v of competitorViews.values()) {
    const latest = v.card_read_history[v.card_read_history.length - 1];
    if (latest === undefined || v.status === 'PEND') continue;
    const startInput = {
      start: latest.start,
      cardType: latest.card_type,
      readAtMs: latest.event_time_ms,
      drawnStartMs: v.start_time_ms,
      clockOffsetMin: input.clock_offset_min,
      startMethod: startMethodOf(v.class_id),
    };
    const warning = startPunchWarning(startInput);
    v.late_start_ms = warning.late_start_ms;
    v.early_start_ms = warning.early_start_ms;
    if (
      v.manual_status !== null ||
      (v.status !== 'OK' && v.status !== 'MP') ||
      latest.finish === null ||
      startMs(startInput) !== null
    ) {
      continue;
    }
    v.missing_start = true;
    const checkMs = checkMsByCompetitor.get(v.id) ?? null;
    if (checkMs !== null) {
      v.suggested_start_ms = checkMs + checkToStartMs;
      v.suggested_start_offset_ms = checkToStartMs;
    }
  }

  // Build per-class results tables. Sort: OK first (by elapsed asc), then MP,
  // then DNF, then PEND. Ties broken by competitor name; equal elapsed shares
  // the place and the next place skips (1, 1, 3 — 02.1-14 Task 7).
  //
  // 02.1-14 Task 9: a class without timing gets no place, time or behind,
  // and sorts by status then name (IOF "UnorderedNoTimes": unordered with
  // respect to times, e.g. by name; status grouping kept as elsewhere).
  const resultsByClass = new Map<string, ResultView[]>();
  for (const cls of input.classes) {
    const inClass: CompetitorView[] = [];
    for (const v of competitorViews.values()) {
      if (v.class_id === cls.id) inClass.push(v);
    }
    const timed = !noTimingClasses.has(cls.id);
    inClass.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (timed
          ? (a.elapsed_time_ms ?? Number.MAX_SAFE_INTEGER) -
            (b.elapsed_time_ms ?? Number.MAX_SAFE_INTEGER)
          : 0) ||
        a.name.localeCompare(b.name)
    );
    let rank = 0;
    let place = 0;
    let prevElapsed: number | null = null;
    let leaderTime: number | null = null;
    const rows: ResultView[] = inClass.map((v) => {
      let p: number | null = null;
      let behind: number | null = null;
      if (timed && v.status === 'OK' && v.elapsed_time_ms !== null) {
        rank++;
        if (v.elapsed_time_ms !== prevElapsed) place = rank;
        prevElapsed = v.elapsed_time_ms;
        p = place;
        if (leaderTime === null) leaderTime = v.elapsed_time_ms;
        behind = v.elapsed_time_ms - leaderTime;
      }
      return {
        competitor_id: v.id,
        name: v.name,
        club: v.club,
        status: v.status,
        elapsed_time_ms: timed ? v.elapsed_time_ms : null,
        place: p,
        behind_leader_ms: behind,
        soft_status: softStatus(v.status, { noTiming: !timed }),
      };
    });
    resultsByClass.set(cls.id, rows);
  }

  return {
    competition_id: input.competition_id,
    competitors: competitorViews,
    results_by_class: resultsByClass,
    pending_unknown_cards: [...pendingUnknownCards].sort((a, b) => a - b),
    check_to_start: {
      n: gaps.length,
      median_ms: medianMs,
      mean_ms: gaps.length === 0 ? null : Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
      offset_ms: checkToStartMs,
    },
    last_event_seq: lastEventSeq,
  };
}

// ---------------------------------------------------------------------------
// Phase 2.1 helper functions
// ---------------------------------------------------------------------------

/** 02.1-14 Task 5: the set of control codes voided course-wide after
 * replaying control_voided / control_unvoided in order. `events` must be
 * sorted by (event_time_ms, local_seq). Shared with the voided-controls GET
 * route so the UI and the projection agree. */
export function voidedControlCodes(events: readonly Event[], competitionId: string): Set<number> {
  const voided = new Set<number>();
  for (const e of events) {
    if (e.competitionId !== competitionId) continue;
    const payload = e.payload as EventPayload;
    if (payload.event_type === 'control_voided') voided.add(payload.control_code);
    else if (payload.event_type === 'control_unvoided') voided.delete(payload.control_code);
  }
  return voided;
}

function filterVoidedLegs(expected: readonly number[], voidedLegs: readonly number[]): number[] {
  if (voidedLegs.length === 0) return [...expected];
  return expected.filter((code) => !voidedLegs.includes(code));
}
