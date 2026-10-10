// Authored for fartola. Not ported from upstream.
//
// Shared props type for the 6 receipt templates (Classic, Standing,
// Detailed, Top4, Minimal, Kids). The shape mirrors the `read` object
// in 01-SKETCHES/.../screens-readout.jsx (the "ReceiptMockup" component
// consumed). The readout view builds an instance per active card_read
// and passes it down through ReceiptMirror → <Template>.
//
// Phase 1 reality: many fields are placeholders because the projection
// pipeline only computes elapsed/place/status today; leg ranks, lost
// times, and per-class top-4 are scaffolded with `null` defaults so the
// templates render without crashing while plan 15+ light up the data.
//
// Locked by 01-13-PLAN.md task 1.

export interface ReceiptPunch {
  /** 1-based ordinal in the course (NOT a station code). */
  code: number | string;
  /** Display split since previous control, e.g. "1:23". */
  split: string;
  /** Cumulative time at this control, e.g. "5:47". */
  time: string;
  /** Truthy on the finish row — sketches print "M" + accent shading. */
  finish?: boolean;
  /** OK at this control; false → red dashed miss tile (PunchGrid). */
  ok?: boolean;
  /** Set when the tile is not a plain OK/miss control: 'struck' = a control
   * voided course-wide (shown "struken", never missing); 'extra' = a punch
   * not on the course; 'order' = a course control punched out of order. */
  kind?: 'struck' | 'extra' | 'order';
  /** A course control punched by hand (SOFT TR 8.1.4 kommentar): OK, no
   * time, shown "manuell". */
  manual?: boolean;
  /** Per-leg place; 1 = fastest split. Detailed template colours green. */
  legRank?: number | null;
  /** Time lost vs the leg leader, e.g. "+0:08". Detailed only. */
  lost?: string | null;
}

export interface ReceiptProgress {
  /** 1-based place in the class, or null if not yet ranked. */
  place: number | null;
  /** Finishers in the same class so far. */
  finishedInClass: number;
  /** Starters in the same class. */
  startersInClass: number;
  /** "+0:34" behind leader, or null when isLeader. */
  behind: string | null;
}

export interface ReceiptRead {
  cardNumber: number;
  name: string;
  cls: string;
  classId: string;
  club: string | null;
  /** SOFT TR 7.5.4: the runner's bib; null/absent = none. */
  bib?: string | null;
  startTime: string;
  readTime: string;
  /** Cumulative time at finish, e.g. "23:14". */
  elapsed: string;
  status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
  /** What the receipt prints for the status: SOFT's name ("Ej godkänd",
   * "Diskad", "Deltagit" …; TA till TR 7.8.2, TR 4.21.3). */
  statusLabel: string;
  place: number | null;
  /** Class without timing: no place or running time; receipts say so. */
  untimed?: boolean;
  punches: ReceiptPunch[];
  progress: ReceiptProgress;
  /** Competition meta — used in the receipt header rows. */
  competitionName: string;
  competitionDate: string;
}

/** Optional top-4 leaderboard slice for the Top4 template. Empty array
 * is acceptable — the template renders a placeholder dash row. */
export interface ReceiptTopRow {
  place: number | null;
  name: string;
  time: string;
  status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
}

export interface ReceiptTemplateProps {
  read: ReceiptRead;
  /** Top-4 only; ignored by the other 5 templates. */
  classResults?: ReceiptTopRow[];
}

export type ReceiptTemplate = 'classic' | 'standing' | 'detailed' | 'top4' | 'minimal' | 'kids';
