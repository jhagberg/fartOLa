// Authored for fartola. Not ported from upstream.
//
// CompetitionState + view types for the pure-reducer projection layer.
// The reducer in `./reduce.ts` turns (events table + course + competitors)
// into this in-memory shape, which the REST GETs (plan 08) and the
// WS results channel (plan 08) consume.
//
// Codex review C-H2 (HIGH): card_read carries top-level start/finish/check/
// clear HalfDayClock fields (Phase 0 NDJSON surface). The reducer reads
// `payload.start` / `payload.finish` directly — `latest_start` + `latest_finish`
// are kept on the CompetitorView so plan 16's IOF XML export can render
// <StartTime> + <FinishTime> without re-walking the event log.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-07-PLAN.md
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-09 D-11 D-12
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2
// - .planning/adr/0003-event-sourcing-as-core-data-model.md
// - REQ-EVT-003 / REQ-EVT-004 (reducer is pure + idempotent)

import type { NdjsonPunch, HalfDayClock } from '@fartola/sportident';

// Phase 2.0 extension (2026-05-18): four operator-flagged states added on
// top of the auto-detected PEND/OK/MP/DNF set. Each maps to an IOF v3
// ResultStatus value (see apps/edge/src/xml/iofExport.ts). MAX is operator-
// manual-only in Phase 2.0; Phase 2.1 will add auto-compute from a future
// class.max_time field.
//   - DNS    → IOF "DidNotStart"  (no-show on race day)
//   - DQ     → IOF "Disqualified"  (operator rule decision)
//   - CANCEL → IOF "Cancelled"     (pre-race entry withdrawn — "Återbud")
//   - MAX    → IOF "OverTime"      (exceeded class time cap — "Maxtid")
export type PunchStatus = 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

/** Subset of PunchStatus an operator can assert via manual_status_set.
 * Auto-detected states (PEND/OK/MP) are NEVER operator-asserted — they fall
 * out of dnfMp.detectStatus naturally. DNF stays asserter-allowed for back-
 * compat with the legacy manual_dnf event. */
export type ManualStatus = 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

/** One competitor's projected view — what readout + receipts render. */
export interface CompetitorView {
  id: string;
  name: string;
  club: string | null;
  class_id: string;
  card_number: number | null;
  status: PunchStatus;
  /** Append-only history of card_read events for this competitor, oldest
   * first. plan 16 IOF export iterates the latest entry; plan 14 receipt
   * mirror can show prior reads. */
  card_read_history: Array<{
    event_time_ms: number;
    card_number: number;
    punches: NdjsonPunch[];
    start: HalfDayClock | null;
    finish: HalfDayClock | null;
  }>;
  latest_punches: NdjsonPunch[];
  /** C-H2: kept on the view so plan 16 (IOF XML export) can render
   * <StartTime> without re-walking the event log. */
  latest_start: HalfDayClock | null;
  /** C-H2: kept on the view so plan 16 (IOF XML export) can render
   * <FinishTime> without re-walking the event log. */
  latest_finish: HalfDayClock | null;
  missing_codes: number[];
  extra_codes: number[];
  out_of_order_codes: number[];
  elapsed_time_ms: number | null;
  /** Back-compat alias retained for IOF export / tests that still read it.
   * When `manual_status` is one of DNS/DQ/CANCEL/MAX or DNF, this carries the
   * operator's free-text reason (1..500 chars). Null when no override is in
   * force. */
  manual_dnf_reason: string | null;
  /** Operator-asserted override status. NULL when no override is in force
   * and the projected status comes from dnfMp.detectStatus over the latest
   * card_read. When set, the reducer skips auto-detection (the override
   * wins until cleared via clear_manual_status). */
  manual_status: ManualStatus | null;
  /** Phase 2.1 (D-16): control codes voided by leg_voided events. Sorted
   * ascending for deterministic snapshots. Voiding a leg removes it from
   * the course-match check and subtracts the leg duration from elapsed. */
  voided_legs: number[];
  /** Phase 2.1 (D-05): assigned start time for the competitor (epoch ms),
   * NULL when no start time has been drawn. Loaded from competitors.start_time_ms. */
  start_time_ms: number | null;
}

/** One row in the per-class results table. ResultView is the projection
 * shape the WS results channel (plan 08) broadcasts and plan 16 reads. */
export interface ResultView {
  competitor_id: string;
  name: string;
  club: string | null;
  status: PunchStatus;
  elapsed_time_ms: number | null;
  /** 1-based place among OK competitors; null for MP/DNF/PEND. */
  place: number | null;
  /** ms behind the leader for OK rows; null otherwise. */
  behind_leader_ms: number | null;
}

/** Top-level reducer output. Maps are used (not arrays) so callers can
 * O(1)-look up competitors by id. */
export interface CompetitionState {
  competition_id: string;
  competitors: Map<string, CompetitorView>;
  results_by_class: Map<string, ResultView[]>;
  /** Card numbers seen via card_read for which no competitor row matched.
   * Drives the walk-up modal (UI-SPEC §"Walk-up modal"). Sorted ascending
   * for deterministic snapshots. */
  pending_unknown_cards: number[];
  /** Highest local_seq of any event consumed by this projection — plan 08
   * uses this to skip already-applied events on incremental rebuilds. */
  last_event_seq: number;
}
