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
import {
  controlRows,
  finishedInClass,
  formatElapsed,
  formatGap,
  halfDayClockGapMs,
  receiptTime,
} from '../templates.ts';

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
  for (const row of controlRows(data)) {
    const tag = row.no.padEnd(3, ' ');
    const code = String(row.code).padEnd(5, ' ');
    if (row.label === 'struken') {
      printer.println(`${tag}  ${code} struken`);
      continue;
    }
    // 02.1-14 Task 9: no split times for an untimed class.
    const splitMs =
      row.punch === null || data.competitor.no_timing ? null : halfDayClockGapMs(prev, row.punch);
    const split = formatElapsed(splitMs).padStart(7, ' ');
    const label = row.label === null ? '' : ` ${row.label}`;
    printer.println(`${tag}  ${code} ${split}     —     —${label}`);
    // An extra punch does not move the running leg start.
    if (row.punch !== null && row.label === null) prev = row.punch;
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

  if (data.competitor.missing_codes.length > 0) {
    printer.println(`Saknade: ${data.competitor.missing_codes.join(', ')}`);
  }
}
