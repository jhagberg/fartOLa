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
  epochToLocalSeconds,
  formatLocalTime,
  softStatus,
  type SoftStatus,
  type StartMethod,
} from '@fartola/shared-types';
import { patchCompetitorStartTime } from '$lib/api/client.ts';
import { t } from '$lib/i18n/index.ts';
import type { ReceiptRead, ReceiptPunch } from '$lib/components/receipt-templates/types.ts';

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
  /** 02.1-14 Task 13 — the competitor's latest read has a finish but no
   * start punch and no drawn start; suggested start = check + offset (both
   * null without a check punch). */
  missing_start: boolean;
  suggested_start_ms: number | null;
  suggested_start_offset_ms: number | null;
  /** 02.1-14 Task 14 — start punch more than 60 s after / before the start
   * time in a class timed from it (ms, positive). Jury warnings only. */
  late_start_ms: number | null;
  early_start_ms: number | null;
}

export interface ReadoutResponse {
  competition_id: string;
  active: boolean;
  current_read: ReadoutHistoryRow | null;
  history: ReadoutHistoryRow[];
  pending_unknown_cards: number[];
}

/** Unique key for a history row — used by Svelte's keyed each and by
 * the flashIn animation lookup. */
export function historyKey(row: ReadoutHistoryRow): string {
  return `${row.event_time_ms}-${row.local_seq}`;
}

const HALF_DAY_SEC = 43200;

/** Running time for a read: finish − start, as the edge projection computes
 * it (dnfMp.startMs, 02.1-14 Task 14): the class's start method picks the
 * start — 'auto' the start time if any, else the punch; 'start_time' the
 * start time only; 'start_punch' the punch, else the start time.
 * No start at all → null; the old first-punch fallback showed a misleading
 * time. Card clocks are compared modulo 12 h (runs under 12 h), so SI5 cards
 * without a PM bit work too. */
export function readElapsedMs(
  row: Pick<ReadoutHistoryRow, 'finish_seconds_in_half_day' | 'start_seconds_in_half_day'>,
  drawnStartMs: number | null,
  startMethod: StartMethod = 'auto'
): number | null {
  if (row.finish_seconds_in_half_day === null) return null;
  const drawn = drawnStartMs === null ? null : epochToLocalSeconds(drawnStartMs) % HALF_DAY_SEC;
  const punch = row.start_seconds_in_half_day;
  const base =
    startMethod === 'start_time'
      ? drawn
      : startMethod === 'start_punch'
        ? (punch ?? drawn)
        : (drawn ?? punch);
  if (base === null) return null;
  const delta = (row.finish_seconds_in_half_day - base) % HALF_DAY_SEC;
  return Math.round((delta < 0 ? delta + HALF_DAY_SEC : delta) * 1000);
}

/** 02.1-14 Task 13: the parts of "Check 10:19:37 + 1:54 → 10:21:31" for a
 * missing start, or null when the start is not missing or there is no
 * suggestion (no check punch). */
export function missingStartHint(
  row: Pick<ReadoutHistoryRow, 'missing_start' | 'suggested_start_ms' | 'suggested_start_offset_ms'>
): { check: string; offset: string; suggested: string } | null {
  const { suggested_start_ms: suggested, suggested_start_offset_ms: offset } = row;
  if (!row.missing_start || suggested === null || offset === null) return null;
  return {
    check: formatLocalTime(suggested - offset),
    offset: formatElapsed(offset),
    suggested: formatLocalTime(suggested),
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

/** 'HH:MM' or 'HH:MM:SS' → epoch ms on the same competition-local day as
 * `refMs` (the suggestion or the read time). Null when not a valid time. */
export function parseStartTimeInput(text: string, refMs: number): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || sec > 59) return null;
  const localMidnightMs = refMs - epochToLocalSeconds(refMs) * 1000;
  return localMidnightMs + (h * 3600 + min * 60 + sec) * 1000;
}

/** 02.1-14 Task 13: "Sätt starttid" — PATCH the edited start time. Returns
 * false (and sends nothing) when the text is not a valid time. */
export async function setStartFromInput(
  competitionId: string,
  competitorId: string,
  text: string,
  refMs: number
): Promise<boolean> {
  const startMs = parseStartTimeInput(text, refMs);
  if (startMs === null) return false;
  await patchCompetitorStartTime(competitionId, competitorId, startMs);
  return true;
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

/** Build a ReceiptRead for the LatestReadCard + ReceiptMirror from a
 * history row + competition meta. */
/** The label a published surface (results screen, receipts) shows for a
 * status: SOFT's names, TA till TR 7.8.2 / TR 4.21.3. The operator's own
 * views keep the detailed status.* labels (Felstämpling, Bröt …). */
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
  competitionName: string;
  competitionDate: string;
  punches?: ReceiptPunch[];
  elapsedMs?: number | null;
  place?: number | null;
  /** 02.1-14 Task 9: class without timing — no running or split times. */
  noTiming?: boolean;
}): ReceiptRead {
  const allPunches: ReceiptPunch[] =
    input.punches ??
    rawPunchesToReceipt(
      input.row.punches,
      input.row.start_seconds_in_half_day,
      input.row.finish_seconds_in_half_day,
      input.row.expected_codes
    );
  const punches = input.noTiming
    ? allPunches.map((p) => ({ ...p, split: '—', time: '—' }))
    : allPunches;
  return {
    cardNumber: input.row.card_number,
    name: input.row.competitor_name ?? 'Okänd',
    cls: input.className,
    classId: input.classId,
    club: input.club,
    startTime: '—',
    readTime: formatTimeOfDay(input.row.event_time_ms),
    elapsed: formatElapsed(input.noTiming ? null : (input.elapsedMs ?? null)),
    status: input.row.status,
    statusLabel: softStatusLabel(
      softStatus(input.row.status, { noTiming: input.noTiming === true })
    ),
    place: input.place ?? null,
    punches,
    progress: {
      place: input.place ?? null,
      finishedInClass: 1,
      startersInClass: 1,
      behind: null,
    },
    competitionName: input.competitionName,
    competitionDate: input.competitionDate,
  };
}
