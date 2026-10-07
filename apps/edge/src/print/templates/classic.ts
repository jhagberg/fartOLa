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
import { formatElapsed, formatGap, halfDayClockGapMs, receiptTime } from '../templates.ts';

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
  for (let i = 0; i < data.course.control_codes.length; i++) {
    const expected = data.course.control_codes[i] as number;
    const actual = data.competitor.latest_punches[i];
    if (actual !== undefined) {
      // 02.1-14 Task 9: no split times for an untimed class.
      const cumMs = data.competitor.no_timing
        ? null
        : halfDayClockGapMs(data.competitor.latest_start, actual);
      const cumStr = formatElapsed(cumMs).padStart(7, ' ');
      const tag = String(i + 1).padEnd(3, ' ');
      const code = String(actual.code).padEnd(5, ' ');
      printer.println(`${tag}      ${code} ${cumStr}`);
    } else {
      const tag = String(i + 1).padEnd(3, ' ');
      const code = String(expected).padEnd(5, ' ');
      printer.println(`${tag}      ${code}      —`);
    }
  }

  printer.drawLine();
  printer.bold(true);
  printer.leftRight('TOTAL', receiptTime(data.competitor));
  printer.bold(false);

  if (data.placeContext.place !== null) {
    printer.println(
      `Plats ${data.placeContext.place} av ${data.placeContext.class_rows.length} i mål`
    );
  }
  const gap = formatGap(data.placeContext.behind_leader_ms);
  if (gap.length > 0) printer.println(gap);
}
