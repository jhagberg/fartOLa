// Authored for fartola. Not ported from upstream.
//
// Speaker view — the wire shape of GET /api/competitions/:id/speaker.
// Plain interfaces: the server builds them, nothing parses them. Times are
// epoch ms (wall clock) or ms since the runner's start (elapsed).

export type SpeakerRunnerStatus = 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

/** A runner's time at one point (a radio control or the finish). */
export interface SpeakerSplit {
  elapsed_ms: number;
  /** Place among the class's runners with a time here; ties share it. */
  place: number;
  behind_ms: number;
}

export interface SpeakerRunner {
  competitor_id: string;
  name: string;
  club: string | null;
  start_ms: number | null;
  status: SpeakerRunnerStatus;
  /** One entry per class radio control (SpeakerClass.controls), null = not passed. */
  passings: Array<SpeakerSplit | null>;
  /** Read-out result with a place (status OK). */
  finish: SpeakerSplit | null;
  /** Punched a finish radio unit, not read out yet: elapsed ms. */
  radio_finish_ms: number | null;
  /** Expected finish (epoch ms) from the last radio passing; null without
   * a passing, after the finish, or when nobody has finished yet. */
  expected_finish_ms: number | null;
}

export interface SpeakerClass {
  class_id: string;
  class_name: string;
  /** Radio control codes on the class's course, in course order. */
  controls: number[];
  runners: SpeakerRunner[];
}

export type SpeakerEventKind = 'radio' | 'finish' | 'radio_finish';

/** One passing or finish for the events strip. */
export interface SpeakerEvent {
  at_ms: number;
  kind: SpeakerEventKind;
  class_id: string;
  competitor_id: string;
  name: string;
  club: string | null;
  /** The radio control; null at the finish. */
  control_code: number | null;
  elapsed_ms: number;
  /** Place and time behind when it happened (later runners not counted).
   * null for radio_finish (not read out yet). */
  place: number | null;
  behind_ms: number | null;
  /** Best time at this point so far. */
  new_leader: boolean;
}

export interface SpeakerBoard {
  /** The competition clock with this snapshot (ADR-0017): clock = epoch +
   * offset. Carried here so an offset change reaches an open view. */
  clock_offset_min: number;
  classes: SpeakerClass[];
  /** Newest first. */
  events: SpeakerEvent[];
}
