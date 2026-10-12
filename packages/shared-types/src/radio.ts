// Authored for fartola. Not ported from upstream.
//
// Radio-control status (ROC input + watchdog) — the wire shape of
// GET /api/competitions/:id/radio/status and PATCH .../radio/settings.
// Plain interfaces: the server builds them, nothing parses them.

export type RadioControlState = 'ok' | 'few' | 'silent';

export type RadioRole = 'control' | 'start' | 'check' | 'finish';

export interface RadioControlStatus {
  /** control: an ordinary control. start/check/finish: one unit of that role. */
  role: RadioRole;
  /** The control code, or the unit's station code for start/check/finish.
   * 0 with unknown_unit. */
  control_code: number;
  /** Cards (SI5) that do not say which unit stamped the time. */
  unknown_unit: boolean;
  /** silent: nothing heard for the silence window while read-out cards
   * passed after the last radio punch. few: under the coverage threshold
   * over the last M minutes. ok otherwise. */
  state: RadioControlState;
  /** Epoch ms when we last RECEIVED a radio punch for this control (not the
   * punch's time of day: a backlog carries old times). null = none yet. */
  last_heard_ms: number | null;
  /** Median of receive time minus punch time over the last M minutes, ms;
   * null when nothing was received in the window. Large = backlog or a
   * sender with a wrong clock. */
  median_delay_ms: number | null;
  /** The control is on the competition's list of expected radio controls. */
  listed: boolean;
  /** Radio punches received at this control, whole competition. */
  received: number;
  /** Read-out card punches at this control in the last M minutes, and how
   * many of them have a radio punch (same card, within ±2 s). */
  window_card_punches: number;
  window_matched: number;
  /** window_matched / window_card_punches; null when there are none. */
  coverage: number | null;
  /** The window coverage split by card type: SIAC (touch-free) and others. */
  siac_card_punches: number;
  siac_matched: number;
  other_card_punches: number;
  other_matched: number;
  /** SIAC coverage far below the others' (SIAC < 50 % while others >= 80 %,
   * at least 5 of each): touch-free punches are not forwarded. */
  siac_problem: boolean;
  /** Radio punches whose date is not the competition date. */
  date_mismatch_count: number;
}

export interface RadioSettings {
  enabled: boolean;
  /** ROC unitId, e.g. "2380". */
  roc_competition_id: string | null;
  /** First ROC row id of the competition; null until known. */
  start_id: number | null;
  last_id: number | null;
  /** Expected radio control codes; a listed one with no radio punch is silent. */
  radio_controls: number[];
  /** Radio codes that are start, check and finish units. */
  start_codes: number[];
  check_codes: number[];
  finish_codes: number[];
  /** Distinct codes heard by radio that are in none of the lists: suggestions. */
  heard_codes: number[];
}

export interface RadioPollStatus {
  last_poll_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  consecutive_failures: number;
}

/** One serial port listened to for autosend records (--radio-serial): a
 * jSh.Radio gateway, an SRR receiver or an online station. */
export interface RadioSerialStatus {
  path: string;
  /** The port is open. A gateway sends nothing between punches, so an open
   * port says the cable is in, not that the radio network is up. */
  connected: boolean;
  /** Why the port is not open, or the last error on it. */
  last_error: string | null;
  /** Epoch ms when the last punch arrived on this port. */
  last_punch_at: number | null;
  /** Punches stored since the program started. */
  punches: number;
  /** Punches already stored (heard twice). */
  duplicates: number;
  /** Punches that arrived while no competition was active: not stored. */
  no_competition: number;
  /** Whole frames that are no punch (other commands, SIAC indicator). */
  ignored: number;
  /** Broken frames (bad checksum, half frames). */
  frame_errors: number;
  /** Broken frames that look like base-protocol records: a station has
   * "legacy protocol" on and must be set to the extended protocol. */
  legacy_records: number;
}

export interface RadioStatus {
  settings: RadioSettings;
  /** null when the poller is not running (tests, --no-bridge boots). */
  poll: RadioPollStatus | null;
  /** The serial ports listened to; empty when none was given. */
  serial: RadioSerialStatus[];
  now_ms: number;
  /** The competition clock's UTC offset in minutes (ADR-0017), to show times. */
  clock_offset_min: number;
  window_min: number;
  silence_min: number;
  coverage_threshold: number;
  controls: RadioControlStatus[];
}
