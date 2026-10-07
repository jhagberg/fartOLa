// Authored for fartola. Not ported from upstream.
//
// Classic receipt template — header (competition name + date) → runner
// name → klass / bricka → splits table (1-based leg, control code, cum
// time) → total time → place + leader gap. Mirrors UI-SPEC §"Receipt
// templates" classic row. Pure renderer — no I/O, no second skogis call.
//
// Locked by 01-15-PLAN.md task 1.

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import {
  controlRows,
  finishedInClass,
  formatElapsed,
  formatGap,
  halfDayClockGapMs,
  receiptTime,
} from '../templates.ts';

export default async function classic(
  printer: ThermalPrinterLike,
  data: ReceiptData
): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(data.competition.name);
  printer.bold(false);
  printer.println(data.competition.date);
  printer.drawLine();

  printer.alignLeft();
  printer.bold(true);
  printer.println(data.competitor.name);
  printer.bold(false);
  if (data.competitor.club !== null && data.competitor.club.length > 0) {
    printer.println(data.competitor.club);
  }
  printer.leftRight(data.classObj.name, `Bricka ${data.competitor.card_number ?? '—'}`);
  printer.drawLine();

  // Splits table — code + cum-time-from-start. Cum derives from the
  // half-day-clock delta between latest_start and each punch (the
  // reducer doesn't precompute per-leg splits today — plan 16 adds them
  // for the IOF XML export and the detailed template can lift them
  // then). For now we render `cum` only.
  printer.println('Sträcka  Kod    Cum');
  for (const row of controlRows(data)) {
    const tag = row.no.padEnd(3, ' ');
    const code = String(row.code).padEnd(5, ' ');
    // 02.1-14 Task 9: no split times for an untimed class.
    const cumMs =
      row.punch === null || data.competitor.no_timing
        ? null
        : halfDayClockGapMs(data.competitor.latest_start, row.punch);
    const cumStr = row.label === 'struken' ? '' : formatElapsed(cumMs).padStart(7, ' ');
    const label = row.label === null ? '' : ` ${row.label}`;
    printer.println(`${tag}      ${code} ${cumStr}${label}`.trimEnd());
  }

  printer.drawLine();
  printer.bold(true);
  printer.leftRight('TOTAL', receiptTime(data.competitor));
  printer.bold(false);

  if (data.placeContext.place !== null) {
    printer.println(`Plats ${data.placeContext.place} av ${finishedInClass(data)} i mål`);
  }
  const gap = formatGap(data.placeContext.behind_leader_ms);
  if (gap.length > 0) printer.println(gap);
}
