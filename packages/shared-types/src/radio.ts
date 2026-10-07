// Authored for fartola. Not ported from upstream.
//
// Radio-control status (ROC input + watchdog) — the wire shape of
// GET /api/competitions/:id/radio/status and PATCH .../radio/settings.
// Plain interfaces: the server builds them, nothing parses them.

export type RadioControlState = 'ok' | 'few' | 'silent';

export interface RadioControlStatus {
  control_code: number;
  /** silent: nothing heard for the silence window while read-out cards
   * passed after the last radio punch. few: under the coverage threshold
   * over the last M minutes. ok otherwise. */
  state: RadioControlState;
  /** Epoch ms of the latest radio punch heard (its time of day, placed on
   * the competition clock). */
  last_heard_ms: number;
  /** Radio punches received at this control, whole competition. */
  received: number;
  /** Read-out card punches at this control in the last M minutes, and how
   * many of them have a radio punch (same card, within ±2 s). */
  window_card_punches: number;
  window_matched: number;
  /** window_matched / window_card_punches; null when there are none. */
  coverage: number | null;
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
}

export interface RadioPollStatus {
  last_poll_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  consecutive_failures: number;
}

export interface RadioStatus {
  settings: RadioSettings;
  /** null when the poller is not running (tests, --no-bridge boots). */
  poll: RadioPollStatus | null;
  now_ms: number;
  window_min: number;
  silence_min: number;
  coverage_threshold: number;
  controls: RadioControlStatus[];
}
