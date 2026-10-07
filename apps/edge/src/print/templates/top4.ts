// Authored for fartola. Not ported from upstream.
//
// Top-4 leaderboard receipt — header → "Topp 4" → top-4 rows for this
// runner's class (rank, name, total time); if this runner is NOT in the
// top 4, an extra "Din placering" footer row shows their position.
// UI-SPEC §"Receipt templates" top4 row.
//
// Locked by 01-15-PLAN.md task 1.

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import { formatGap, rowTime } from '../templates.ts';

export default async function top4(printer: ThermalPrinterLike, data: ReceiptData): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(data.competition.name);
  printer.bold(false);
  printer.println(data.competition.date);
  printer.drawLine();

  printer.bold(true);
  printer.println(`Topp 4 — ${data.classObj.name}`);
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  const rows = data.placeContext.class_rows;
  const top = rows.slice(0, 4);
  for (const row of top) {
    const place = row.place ?? '—';
    const placeStr = String(place).padEnd(3, ' ');
    const time = rowTime(row).padStart(7, ' ');
    const highlight = row.competitor_id === data.competitor.id;
    if (highlight) printer.bold(true);
    printer.println(`${placeStr} ${row.name.slice(0, 18).padEnd(18, ' ')} ${time}`);
    if (highlight) printer.bold(false);
  }

  // If this runner is not in the top 4, footer row.
  const thisIdx = rows.findIndex((r) => r.competitor_id === data.competitor.id);
  if (thisIdx >= 4) {
    printer.drawLine();
    printer.println('Din placering:');
    const row = rows[thisIdx] as (typeof rows)[number];
    printer.bold(true);
    printer.leftRight(`${row.place ?? '—'}. ${row.name}`, rowTime(row));
    printer.bold(false);
    const gap = formatGap(row.behind_leader_ms);
    if (gap.length > 0) printer.println(gap);
  } else if (thisIdx >= 0) {
    printer.drawLine();
    const gap = formatGap(data.placeContext.behind_leader_ms);
    if (gap.length > 0) printer.println(gap);
  }
}
