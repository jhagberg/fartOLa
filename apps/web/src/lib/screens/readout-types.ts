// Authored for fartola. Not ported from upstream.
//
// Wire-side types + formatters for the readout view. Mirrors the
// `ReadoutResponse` shape from apps/edge/src/routes/readout.ts (plan 09)
// without importing edge code (the SPA stays free of server-side deps).
//
// The transform `toReceiptRead` adapts a HistoryRow into the
// ReceiptRead shape consumed by ReceiptMirror + LatestReadCard. Phase 1
// reality: many fields (place, elapsed, splits) are placeholders until
// the projection pipeline lights them up. We populate plausible defaults
// so the templates render without crashing.
//
// Locked by 01-13-PLAN.md task 2 + interfaces.

import {
  formatClockTime,
  parseTimeOfDay,
  softStatus,
  startBeforeFinishMs,
  type SoftStatus,
} from '@fartola/shared-types';
import { patchCompetitorStartTime } from '#lib/api/client.ts';
import { t } from '#lib/i18n/index.ts';
import type { ReceiptRead, ReceiptPunch } from '#lib/components/receipt-templates/types.ts';

export type ReadoutStatus = 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

export interface RawPunch {
  code: number;
  seconds_in_half_day: number;
  half_day: number;
}

export interface ReadoutHistoryRow {
  event_time_ms: number;
  local_seq: number;
  card_number: number;
  card_type: string;
  competitor_id: string | null;
  competitor_name: string | null;
  status: ReadoutStatus;
  unmatched: boolean;
  punches: RawPunch[];
  finish_seconds_in_half_day: number | null;
  finish_half_day: number | null;
  start_seconds_in_half_day: number | null;
  start_half_day: number | null;
  /** Firmware-side name from the SI card (owner programs via SPORTident
   * Config+). Non-null only on unmatched rows; pre-fills the walk-up
   * name field. Most rental cards have card_holder=null. */
  card_holder_hint: string | null;
  /** Phase 2.0 Plan 02-05 — non-null when the card_number has an open
   * hired_cards row in this competition. Drives the Hyrbricka
   * finish-readout toast. Explicit null when no open rental — the SPA
   * branches on `hired_card_open !== null` without `in` checks. */
  hired_card_open: {
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    note: string | null;
  } | null;
  /** Phase 2.1 — course comparison breakdown. Lets the UI render *which*
   * controls were missed / extra / out of order rather than just the
   * OK/MP/DNF label. All three are empty arrays for unmatched cards and
   * for matched cards whose class has no course assigned. */
  missing_codes: number[];
  extra_codes: number[];
  out_of_order_codes: number[];
  /** Ordered expected control codes for the competitor's course; empty
   * when the class has no course or the card is unmatched. */
  expected_codes: number[];
  /** Phase 2.1 (plan 13) — mirrors CompetitorView.manual_status. Non-null
   * when the current status was set by an operator override. null means
   * the status is auto-detected from card_read + course. The UI uses this
   * to show the clear button only for manual overrides, not for auto-DNF. */
  manual_status: 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX' | 'MP' | null;
  /** The drawn start (epoch ms) and the official running time as the
   * backend's scoring resolved them; the UI shows these and never
   * recomputes timing from the card. */
  start_time_ms: number | null;
  elapsed_time_ms: number | null;
  /** 02.1-14 Task 13 — the competitor's latest read has a finish but no
   * start punch and no drawn start; suggested start = check + offset (both
   * null without a check punch). */
  missing_start: boolean;
  suggested_start_ms: number | null;
  suggested_start_offset_ms: number | null;
  /** This read's finish as epoch ms, as the backend computes the running
   * time (null without one); an edited start is resolved before it. */
  finish_ms: number | null;
  /** 02.1-14 Task 14 — start punch more than 60 s after / before the start
   * time in a class timed from it (ms, positive). Jury warnings only. */
  late_start_ms: number | null;
  early_start_ms: number | null;
  /** Secretariat corrections in force for the runner (SOFT TR 4.20.6):
   * the finish time by hand and why; null when none. */
  manual_finish_ms: number | null;
  manual_finish_reason: string | null;
  /** Controls punched by hand (SOFT TR 8.1.4 kommentar), no time. */
  manual_punches: Array<{ control_code: number; reason: string }>;
  /** Time addition in whole minutes (SOFT TR 10.4.2), 0 for none; already
   * in elapsed_time_ms. */
  time_addition_min: number;
  time_addition_reason: string | null;
  /** The runner's current standing in the class (projection results rows):
   * place and ms behind the leader are null for MP/DNF/untimed/unplaced;
   * finished = runners with a place, starters = all in the class. */
  class_place: number | null;
  class_behind_leader_ms: number | null;
  class_finished_count: number;
  class_starters_count: number;
}

export interface ReadoutResponse {
  competition_id: string;
  active: boolean;
  current_read: ReadoutHistoryRow | null;
  history: ReadoutHistoryRow[];
  pending_unknown_cards: number[];
  /** Control codes voided course-wide now (shown "struken", never missing). */
  voided_codes: number[];
  /** The competition clock's UTC offset in minutes (ADR-0017), sent with
   * the data it formats; null for an unknown competition. */
  clock_offset_min: number | null;
}

/** Unique key for a history row — used by Svelte's keyed each and by
 * the flashIn animation lookup. */
export function historyKey(row: ReadoutHistoryRow): string {
  return `${row.event_time_ms}-${row.local_seq}`;
}

/** 02.1-14 Task 13: the parts of "Check 10:19:37 + 1:54 → 10:21:31" for a
 * missing start, on the competition clock (`clockOffsetMin`), or null when
 * the start is not missing or there is no suggestion (no check punch). */
export function missingStartHint(
  row: Pick<
    ReadoutHistoryRow,
    'missing_start' | 'suggested_start_ms' | 'suggested_start_offset_ms'
  >,
  clockOffsetMin: number
): { check: string; offset: string; suggested: string } | null {
  const { suggested_start_ms: suggested, suggested_start_offset_ms: offset } = row;
  if (!row.missing_start || suggested === null || offset === null) return null;
  return {
    check: formatClockTime(suggested - offset, clockOffsetMin),
    offset: formatElapsed(offset),
    suggested: formatClockTime(suggested, clockOffsetMin),
  };
}

/** 02.1-14 Task 14: "Sen start +3:12" / "Tjuvstart? −0:05" for the read-out
 * card — an i18n key and the difference — or null. */
export function startWarning(
  row: Pick<ReadoutHistoryRow, 'late_start_ms' | 'early_start_ms'>
): { key: 'ro.lateStart' | 'ro.earlyStart'; diff: string } | null {
  if (row.late_start_ms !== null)
    return { key: 'ro.lateStart', diff: formatElapsed(row.late_start_ms) };
  if (row.early_start_ms !== null) {
    return { key: 'ro.earlyStart', diff: formatElapsed(row.early_start_ms) };
  }
  return null;
}

/** An edited start as epoch ms, or why not. */
export type StartEntry = { startMs: number } | { error: 'invalid' | 'after_finish' };

/** 'HH:MM' or 'HH:MM:SS' on the competition clock (`clockOffsetMin`) → a
 * start before `finishMs` (as the backend computes the running time): the
 * latest such time not after the finish, so 23:50 against a finish at 00:10
 * is the day before; more than 12 h before it means the start is after the
 * finish. One fixed offset, so DST nights are no different. */
export function resolveStartInput(
  text: string,
  finishMs: number | null,
  clockOffsetMin: number
): StartEntry {
  const seconds = parseTimeOfDay(text);
  if (seconds === null || finishMs === null) return { error: 'invalid' };
  const startMs = startBeforeFinishMs(seconds, finishMs, clockOffsetMin);
  return startMs === null ? { error: 'after_finish' } : { startMs };
}

/** 02.1-14 Task 13: "Sätt starttid" — PATCH the edited start time. Sends
 * nothing when the text is not a time, or the start would be after the
 * finish. */
export async function setStartFromInput(
  competitionId: string,
  competitorId: string,
  text: string,
  finishMs: number | null,
  clockOffsetMin: number
): Promise<'ok' | 'invalid' | 'after_finish'> {
  const entry = resolveStartInput(text, finishMs, clockOffsetMin);
  if ('error' in entry) return entry.error;
  await patchCompetitorStartTime(competitionId, competitorId, entry.startMs);
  return 'ok';
}

/** Format `ms` (UTC epoch millis) as `HH:MM:SS` in the local timezone.
 * Used for the readTime column. */
export function formatTimeOfDay(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Format an elapsed duration in milliseconds as `M:SS` or `H:MM:SS`. */
export function formatElapsed(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format elapsed duration with one decimal place for sprint/tenths display
 * (D-17). Returns `M:SS.t` or `H:MM:SS.t`. The tenths digit is computed
 * from the sub-second ms remainder so display is consistent with the
 * internal ms precision. */
export function formatElapsedTenths(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const tenths = Math.floor((ms % 1000) / 100);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

/** Format split as `M:SS` from a duration in half-day seconds. */
function formatSplit(sec: number): string {
  if (sec < 0) sec += 43200;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Convert raw card punches → ReceiptPunch[] with split + cumulative times.
 * When `expectedCodes` is non-empty the result is course-shaped: one tile
 * per expected control in course order, with `ok: false` + dashes for
 * codes that were never punched. Extra punches the runner made that don't
 * belong to the course are appended at the end with `ok: false` so the
 * operator still sees them. When `expectedCodes` is empty (no class /
 * unmatched card) we fall back to a raw render — every punch shown ok.
 *
 * Splits are gap-from-previous; cumulative is gap-from-start (or first
 * punch if no start). Half-day rollover is handled by adding 43200s when
 * the delta would be negative. */
export function rawPunchesToReceipt(
  raw: RawPunch[],
  startSecondsInHalfDay: number | null,
  finishSecondsInHalfDay: number | null,
  expectedCodes: number[] = []
): ReceiptPunch[] {
  const result: ReceiptPunch[] = [];
  if (raw.length === 0 && expectedCodes.length === 0) return result;
  const baseSec = startSecondsInHalfDay ?? raw[0]?.seconds_in_half_day ?? 0;
  let prevSec = baseSec;

  if (expectedCodes.length === 0) {
    // No course assigned — render raw punches as-is.
    for (const p of raw) {
      const splitSec = p.seconds_in_half_day - prevSec;
      const cumSec = p.seconds_in_half_day - baseSec;
      result.push({
        code: p.code,
        split: formatSplit(splitSec),
        time: formatSplit(cumSec),
        ok: true,
      });
      prevSec = p.seconds_in_half_day;
    }
  } else {
    // Slot-by-slot match: walk expected course, greedy-find each code in
    // the remaining raw punches. Unmatched expected → miss tile. Any
    // raw punches left over after the walk are extras → appended ok:false.
    const consumed = new Array<boolean>(raw.length).fill(false);
    let actualIdx = 0;
    for (const expectedCode of expectedCodes) {
      let foundIdx = -1;
      for (let j = actualIdx; j < raw.length; j++) {
        if (raw[j]!.code === expectedCode) {
          foundIdx = j;
          break;
        }
      }
      if (foundIdx >= 0) {
        const p = raw[foundIdx]!;
        const splitSec = p.seconds_in_half_day - prevSec;
        const cumSec = p.seconds_in_half_day - baseSec;
        result.push({
          code: p.code,
          split: formatSplit(splitSec),
          time: formatSplit(cumSec),
          ok: true,
        });
        prevSec = p.seconds_in_half_day;
        consumed[foundIdx] = true;
        actualIdx = foundIdx + 1;
      } else {
        result.push({
          code: expectedCode,
          split: '—',
          time: '—',
          ok: false,
        });
      }
    }
    // Append any raw punches the matcher skipped (extras / wrong-order
    // punches that didn't slot in). They retain their actual splits so
    // the operator can see when they happened.
    for (let j = 0; j < raw.length; j++) {
      if (consumed[j]) continue;
      const p = raw[j]!;
      const cumSec = p.seconds_in_half_day - baseSec;
      result.push({
        code: p.code,
        split: '—',
        time: formatSplit(cumSec),
        ok: false,
      });
    }
  }

  if (finishSecondsInHalfDay !== null) {
    const splitSec = finishSecondsInHalfDay - prevSec;
    const cumSec = finishSecondsInHalfDay - baseSec;
    result.push({
      code: 'F',
      split: formatSplit(splitSec),
      time: formatSplit(cumSec),
      finish: true,
    });
  }
  return result;
}

/** Label the tiles `rawPunchesToReceipt` built for a course (course-shaped:
 * one tile per expected control, then leftover punches, then the finish) so
 * the UI can name them in text:
 *   - a voided control's tile → 'struck' (counts as neither OK nor missing);
 *   - a missed control punched by hand → OK and `manual` (SOFT TR 8.1.4
 *     kommentar): each code in `manualCodes` takes the first missed tile of
 *     that code, as the edge projection does (dnfMp.matchCourse);
 *   - a leftover punch of a control that is on the course but missing from
 *     its place → 'order' ("fel ordn."); any other leftover → 'extra';
 *   - a leftover punch of a voided control is dropped (the struck tile
 *     already stands for it).
 * Display only — status and missing_codes come from the edge projection.
 * Without a course (`expectedCodes` empty) the tiles are returned as is. */
export function classifyPunches(
  tiles: ReceiptPunch[],
  expectedCodes: number[] = [],
  voidedCodes: number[] = [],
  manualCodes: number[] = []
): ReceiptPunch[] {
  if (expectedCodes.length === 0) return tiles;
  const voided = new Set(voidedCodes);
  const pool = [...manualCodes];
  const course = tiles.slice(0, expectedCodes.length).map((p, i): ReceiptPunch => {
    if (voided.has(expectedCodes[i]!)) return { ...p, ok: true, kind: 'struck' };
    const m = p.ok === false ? pool.indexOf(p.code as number) : -1;
    if (m === -1) return p;
    pool.splice(m, 1);
    return { ...p, ok: true, manual: true };
  });
  const missed = new Set(course.flatMap((p) => (p.ok === false ? [p.code] : [])));
  const out: ReceiptPunch[] = [];
  tiles.forEach((p, i) => {
    if (p.finish) out.push(p);
    else if (i < expectedCodes.length) {
      out.push(course[i]!);
    } else if (!voided.has(p.code as number)) {
      out.push({ ...p, kind: missed.has(p.code) ? 'order' : 'extra' });
    }
  });
  return out;
}

/** "+0:34" behind the class leader for the receipts; null for the leader,
 * and for a runner without a place. */
export function classBehind(
  row: Pick<ReadoutHistoryRow, 'class_place' | 'class_behind_leader_ms'>
): string | null {
  const ms = row.class_behind_leader_ms ?? null;
  return row.class_place == null || row.class_place === 1 || ms === null || ms <= 0
    ? null
    : `+${formatElapsed(ms)}`;
}

/** Build a ReceiptRead for the LatestReadCard + ReceiptMirror from a
 * history row + competition meta. */
/** The label a published surface (results screen, receipts) shows for a
 * status: SOFT's names, TA till TR 7.8.2 / TR 4.21.3. The operator's own
 * views keep the detailed status.* labels (Felstämplad, Utgått …). */
export function softStatusLabel(key: SoftStatus): string {
  return t(`soft.status.${key}`);
}

/** What a results-table row shows (TA till TR 7.8.2): place and time only
 * for an approved timed run; every status row carries SOFT's name instead. */
export function resultRowCells(r: {
  soft_status: SoftStatus;
  place: number | null;
  elapsed_time_ms: number | null;
}): { place: string; time: string; label: string } {
  const timed = r.soft_status === 'OK';
  return {
    place: timed && r.place !== null ? String(r.place) : '—',
    time: timed ? formatElapsed(r.elapsed_time_ms) : '—',
    label: softStatusLabel(r.soft_status),
  };
}

export function toReceiptRead(input: {
  row: ReadoutHistoryRow;
  className: string;
  classId: string;
  club: string | null;
  /** SOFT TR 7.5.4: the runner's bib, printed on Klassisk and Detaljerad. */
  bib?: string | null;
  competitionName: string;
  competitionDate: string;
  punches?: ReceiptPunch[];
  elapsedMs?: number | null;
  place?: number | null;
  /** 02.1-14 Task 9: class without timing — no running or split times. */
  noTiming?: boolean;
  /** Control codes voided course-wide; their tiles read "struken". */
  voidedCodes?: number[];
}): ReceiptRead {
  const allPunches: ReceiptPunch[] =
    input.punches ??
    classifyPunches(
      rawPunchesToReceipt(
        input.row.punches,
        input.row.start_seconds_in_half_day,
        input.row.finish_seconds_in_half_day,
        input.row.expected_codes
      ),
      input.row.expected_codes,
      input.voidedCodes,
      input.row.manual_punches.map((p) => p.control_code)
    );
  const place = input.place ?? input.row.class_place ?? null;
  const punches = input.noTiming
    ? allPunches.map((p) => ({ ...p, split: '—', time: '—' }))
    : allPunches;
  return {
    cardNumber: input.row.card_number,
    name: input.row.competitor_name ?? 'Okänd',
    cls: input.className,
    classId: input.classId,
    club: input.club,
    bib: input.bib ?? null,
    startTime: '—',
    readTime: formatTimeOfDay(input.row.event_time_ms),
    elapsed: formatElapsed(input.noTiming ? null : (input.elapsedMs ?? null)),
    status: input.row.status,
    statusLabel: softStatusLabel(
      softStatus(input.row.status, { noTiming: input.noTiming === true })
    ),
    place,
    untimed: input.noTiming === true,
    punches,
    progress: {
      place,
      finishedInClass: input.row.class_finished_count ?? 0,
      startersInClass: input.row.class_starters_count ?? 0,
      behind: classBehind(input.row),
    },
    competitionName: input.competitionName,
    competitionDate: input.competitionDate,
  };
}
