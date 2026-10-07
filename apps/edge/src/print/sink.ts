// Authored for fartola. Not ported from upstream.
//
// PrinterSink interface — PATTERNS S-2 sink injection. Production passes
// the real node-thermal-printer (ESC/POS) driver (plan 15); the walking
// skeleton (plan 03) and unit tests pass the stdout-sink or an in-memory
// recorder. The interface is intentionally minimal: isPrinterConnected
// for the UI status badge, print(envelope) for the actual receipt emit.
//
// Plan 15 refines PrintEnvelope.data into a typed ReceiptData shape that
// the production ESC/POS driver consumes (resolved competitor + competition
// + class + course + placeContext + optional skogisStats for the kids
// template). For plan 03 backward-compat, the stdout-sink continues to
// accept the same envelope shape verbatim — it serialises to JSON via
// JSON.stringify which doesn't care about the type refinement.
//
// W-3 LOCKED (plan 15): skogisStats lives inside data so the kids template
// is a thin renderer (NO second generateSkogis call inside the template).
// The print route + auto-print bridge populate skogisStats at the envelope
// construction site for template === 'kids'; for the other 5 templates the
// field is omitted (undefined).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-03-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-15-PLAN.md task 1
//   (PrintEnvelope.data refined to ReceiptData)
// - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md §S-2
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Receipt templates" (six template names locked here so plan 15's
//   ESC/POS implementation has a stable contract)
//
// PATTERNS S-6 (snake_case at the I/O boundary): receipt fields stay
// snake_case in the print payload — see stdout-sink.ts JSON keys.

import type { CompetitorView, ResultView } from '../projection/types.ts';
import type { SkogisStats } from '@fartola/shared-types';

export type ReceiptTemplate = 'classic' | 'standing' | 'detailed' | 'top4' | 'minimal' | 'kids';

/** Minimal competition snapshot the templates need. snake_case at the I/O
 * boundary (PATTERNS S-6). */
export interface PrintCompetition {
  id: string;
  name: string;
  date: string;
  receipt_template: ReceiptTemplate;
  auto_print: boolean;
}

/** Minimal class snapshot. */
export interface PrintClass {
  id: string;
  name: string;
}

/** Minimal course snapshot — ordered control codes drive the splits table. */
export interface PrintCourse {
  id: string;
  name: string;
  length_m: number | null;
  climb_m: number | null;
  control_codes: number[];
  /** Control codes voided course-wide; printed as "struken", never missing.
   * Omitted/empty when none. */
  voided_codes?: number[];
}

/** Placement context resolved at envelope construction (NOT inside the
 * template). For OK rows: place + behind_leader_ms + leaderName + classRows.
 * For non-OK rows: place=null, behind_leader_ms=null. classRows is the full
 * per-class result list (top-4 template slices it). */
export interface PrintPlaceContext {
  place: number | null;
  behind_leader_ms: number | null;
  leader_name: string | null;
  class_rows: ResultView[];
}

/** ReceiptData — the typed `data` field of PrintEnvelope. The Phase-1
 * generic template surface; stdout-sink consumes it verbatim. */
export interface ReceiptData {
  competitor: CompetitorView;
  competition: PrintCompetition;
  classObj: PrintClass;
  course: PrintCourse;
  placeContext: PrintPlaceContext;
  /** Required when template === 'kids'; omitted otherwise. Populated at
   * the envelope construction site (route handler / auto-print bridge) so
   * the kids template is a thin renderer (W-3 LOCKED). */
  skogisStats?: SkogisStats;
}

export interface PrintEnvelope {
  template: ReceiptTemplate;
  competition_id: string;
  card_number: number;
  /** Plan 15: stays `unknown` at the interface level for back-compat with
   * the plan-03 walking-skeleton dev simulate-read path (which passes a
   * narrow `{ punches }` payload). Production handlers (routes/print.ts +
   * auto-print bridge) pass a fully populated ReceiptData (see the typed
   * shape above); the ESC/POS renderer narrows via a structural cast at
   * the entry point. */
  data: unknown;
}

export interface PrinterSink {
  /** Liveness probe for the UI status badge. The stdout sink always
   * returns true; the ESC/POS driver returns false when no /dev/usb/lp0
   * is detected. */
  isPrinterConnected(): Promise<boolean>;
  /** Emit a receipt. Implementations must not throw on a disconnected
   * printer — surface the failure via isPrinterConnected() instead so the
   * REST handler can return a 503 cleanly. */
  print(envelope: PrintEnvelope): Promise<void>;
}
