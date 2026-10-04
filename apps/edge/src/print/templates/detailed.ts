// Authored for fartola. Not ported from upstream.
//
// Detailed receipt — per-leg analysis with split time, leg rank, and
// time-lost-to-leader columns. UI-SPEC §"Receipt templates" detailed row.
// Phase-1 caveat: legRank + timeLost-per-leg are not yet on CompetitorView
// (plan 16 computes them for the IOF XML export). For now we print the
// raw split times + cum; the rank/lost columns surface as `—` placeholders
// that plan 16's reducer extension fills in.
//
// Locked by 01-15-PLAN.md task 1.

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import { formatElapsed, formatGap, halfDayClockGapMs, receiptTime } from '../templates.ts';

export default async function detailed(
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
  printer.leftRight(data.classObj.name, `Bricka ${data.competitor.card_number ?? '—'}`);
  printer.drawLine();

  printer.println('Str  Kod    Split   Rank Lost');
  let prev = data.competitor.latest_start;
  for (let i = 0; i < data.course.control_codes.length; i++) {
    const expected = data.course.control_codes[i] as number;
    const actual = data.competitor.latest_punches[i];
    if (actual !== undefined) {
      // 02.1-14 Task 9: no split times for an untimed class.
      const splitMs = data.competitor.no_timing ? null : halfDayClockGapMs(prev, actual);
      const tag = String(i + 1).padEnd(3, ' ');
      const code = String(actual.code).padEnd(5, ' ');
      const split = formatElapsed(splitMs).padStart(7, ' ');
      printer.println(`${tag}  ${code} ${split}     —     —`);
      prev = actual;
    } else {
      const tag = String(i + 1).padEnd(3, ' ');
      const code = String(expected).padEnd(5, ' ');
      printer.println(`${tag}  ${code}      —     —     —`);
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

  if (data.competitor.missing_codes.length > 0) {
    printer.println(`Saknade: ${data.competitor.missing_codes.join(', ')}`);
  }
}
