// Authored for fartola. Not ported from upstream.
//
// Minimal receipt — fastest possible printout. Header → name + class +
// bricka → big total → place + gap. No splits table. UI-SPEC §"Receipt
// templates" minimal row.
//
// Locked by 01-15-PLAN.md task 1.

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import { formatGap, receiptTime } from '../templates.ts';

export default async function minimal(
  printer: ThermalPrinterLike,
  data: ReceiptData
): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(data.competition.name);
  printer.bold(false);
  printer.drawLine();

  printer.println(data.competitor.name);
  printer.println(`${data.classObj.name} · Bricka ${data.competitor.card_number ?? '—'}`);
  printer.newLine();

  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(receiptTime(data.competitor));
  printer.bold(false);
  printer.setTextNormal();

  if (data.placeContext.place !== null) {
    printer.println(`Plats ${data.placeContext.place} av ${data.placeContext.class_rows.length}`);
  }
  const gap = formatGap(data.placeContext.behind_leader_ms);
  if (gap.length > 0) printer.println(gap);
}
