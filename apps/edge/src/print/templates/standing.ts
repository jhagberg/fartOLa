// Authored for fartola. Not ported from upstream.
//
// Standing receipt — minimalist focus on the position. Header → name →
// total time (large) → "PLATS X av Y i mål" → leader gap. UI-SPEC
// §"Receipt templates" standing row.
//
// Locked by 01-15-PLAN.md task 1.

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import { formatGap, receiptTime } from '../templates.ts';

export default async function standing(
  printer: ThermalPrinterLike,
  data: ReceiptData
): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(data.competition.name);
  printer.bold(false);
  printer.println(data.competition.date);
  printer.drawLine();

  printer.bold(true);
  printer.println(data.competitor.name);
  printer.bold(false);
  printer.println(data.classObj.name);
  printer.newLine();

  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(receiptTime(data.competitor));
  printer.bold(false);
  printer.setTextNormal();

  if (data.placeContext.place !== null) {
    printer.println(
      `PLATS ${data.placeContext.place} av ${data.placeContext.class_rows.length} i mål`
    );
  } else if (data.competitor.status === 'DNF') {
    printer.println('DNF');
  } else if (data.competitor.status === 'MP') {
    printer.println('MP — missing punch');
  } else {
    printer.println('Väntar på data');
  }
  const gap = formatGap(data.placeContext.behind_leader_ms);
  if (gap.length > 0) printer.println(gap);
}
