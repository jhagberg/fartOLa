// Authored for fartola. Not ported from upstream.
//
// Template dispatcher + the structural type for the subset of
// node-thermal-printer's API that the templates use (ThermalPrinterLike).
// Six templates: classic, standing, detailed, top4, minimal, kids. Each
// is a pure async (printer, data) -> void function — no I/O of its own,
// no state, no second generateSkogis call inside the template (W-3
// LOCKED — kids reads stats from data.skogisStats populated by the route
// handler / auto-print bridge at the envelope construction site).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-15-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md
//   §"Receipt templates" + §"Receipt-specific typography"

import type { HalfDayClock, NdjsonPunch } from '@fartola/sportident';

import type { ReceiptData, ReceiptTemplate } from './sink.ts';

import classic from './templates/classic.ts';
import standing from './templates/standing.ts';
import detailed from './templates/detailed.ts';
import top4 from './templates/top4.ts';
import minimal from './templates/minimal.ts';
import kids from './templates/kids.ts';

/** Structural subset of node-thermal-printer's ThermalPrinter the templates
 * call. Keeping this typed locally means a) the tests can inject a fake
 * without `as any` casts, and b) we don't import the heavy real-library
 * type into every template module (PATTERNS S-3 stays lazy). */
export interface ThermalPrinterLike {
  isPrinterConnected(): Promise<boolean>;
  println(text: string): void;
  print(text: string): void;
  newLine(): void;
  bold(on: boolean): void;
  alignLeft(): void;
  alignCenter(): void;
  alignRight(): void;
  drawLine(character?: string): void;
  cut(options?: { feed?: number; verticalTabAmount?: number }): void;
  printImageBuffer(buffer: Buffer): Promise<Buffer>;
  setTextNormal(): void;
  setTextDoubleHeight(): void;
  setTextDoubleWidth(): void;
  execute(): Promise<void>;
  clear(): void;
  leftRight(left: string, right: string): void;
}

export type TemplateRenderer = (
  printer: ThermalPrinterLike,
  data: ReceiptData
) => Promise<void> | void;

const RENDERERS: Record<ReceiptTemplate, TemplateRenderer> = {
  classic,
  standing,
  detailed,
  top4,
  minimal,
  kids,
};

/** Render `data` to the printer using the named template. Pure dispatcher —
 * no fallbacks; an unknown template name is a programmer bug (the route
 * handler validates against the ReceiptTemplate union before reaching us). */
export async function renderTemplate(
  printer: ThermalPrinterLike,
  name: ReceiptTemplate,
  data: ReceiptData
): Promise<void> {
  await RENDERERS[name](printer, data);
}

// Format helpers shared by every text template -------------------------------

/** Format elapsed milliseconds as `M:SS` or `H:MM:SS` (auto). */
export function formatElapsed(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec - h * 3600) / 60);
  const s = totalSec - h * 3600 - m * 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Format the +M:SS leader-gap suffix used by every template's place line. */
export function formatGap(behindMs: number | null): string {
  if (behindMs === null) return '';
  if (behindMs === 0) return 'Leder';
  return `+${formatElapsed(behindMs)} efter ledaren`;
}

/** Subtract two half-day clocks (modular wrap-around). Returns the gap in
 * milliseconds, or null if either argument is null. The reducer already
 * handles half-day rollover for elapsed_time_ms; we use the same modular
 * formula here for individual splits. */
export function halfDayClockGapMs(
  from: { seconds_in_half_day: number; half_day: 0 | 1 } | HalfDayClock | null,
  to: { seconds_in_half_day: number; half_day: 0 | 1 } | NdjsonPunch | HalfDayClock | null
): number | null {
  if (from === null || to === null) return null;
  const fromSec = from.seconds_in_half_day + from.half_day * 12 * 3600;
  const toSec = to.seconds_in_half_day + to.half_day * 12 * 3600;
  let diff = toSec - fromSec;
  if (diff < 0) diff += 24 * 3600;
  return diff * 1000;
}

// ---------------------------------------------------------------------------
// Start list thermal print template (Plan 02.1-03).
//
// Renders a per-class start list to the thermal printer:
//   - Header: class name + event date
//   - Rows: bib/startnr | name | club | start time (HH:MM:SS)
//
// This is a standalone renderer — not part of the ReceiptTemplate receipt
// system — because it operates on a list of starters for a whole class, not
// an individual competitor's receipt.
// ---------------------------------------------------------------------------

export interface StartListEntry {
  name: string;
  club: string | null;
  startTimeMs: number;
  bibNumber?: string | null;
}

/** Format epoch ms as HH:MM:SS (local wall clock from the competition date).
 * We use UTC here because start times are stored as epoch ms (UTC) and the
 * competition date is already a local date string — converting both to UTC
 * keeps the formatting deterministic across time zones in tests. */
export function formatStartTime(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Render a class start list to the thermal printer. Pure: no I/O. */
export async function renderStartListTemplate(
  printer: ThermalPrinterLike,
  className: string,
  date: string,
  entries: StartListEntry[]
): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(className);
  printer.bold(false);
  printer.println(date);
  printer.drawLine();

  printer.alignLeft();
  // Sort by start time ascending.
  const sorted = [...entries].sort((a, b) => a.startTimeMs - b.startTimeMs);
  for (const entry of sorted) {
    const time = formatStartTime(entry.startTimeMs);
    const bib = entry.bibNumber != null && entry.bibNumber.length > 0 ? entry.bibNumber : '—';
    const club = entry.club != null && entry.club.length > 0 ? entry.club : '';
    printer.leftRight(`${bib} ${entry.name}`, time);
    if (club.length > 0) {
      printer.println(`   ${club}`);
    }
  }
  printer.drawLine();
  printer.cut();
}
