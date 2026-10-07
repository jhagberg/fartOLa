// Authored for fartola. Not ported from upstream.
//
// Kids receipt template — Skogis procedural critter rasterised to a
// monochrome PNG via sharp (apps/edge/src/print/kids-svg-to-bitmap.ts).
// The template reads data.skogisStats from the envelope (populated at
// the construction site by routes/print.ts and the auto-print bridge);
// it does NOT call skogisFromInput a second time (W-3 LOCKED).
//
// Lazy native require lives in kids-svg-to-bitmap.ts (sharp); this
// template stays a pure renderer.
//
// Locked by:
// - 01-15-PLAN.md task 1 (stub)
// - 01-15-PLAN.md task 2b (real bitmap pipeline)

import type { ReceiptData } from '../sink.ts';
import type { ThermalPrinterLike } from '../templates.ts';
import { finishedInClass, formatElapsed, receiptTime } from '../templates.ts';
import { generateKidsBitmap } from '../kids-svg-to-bitmap.ts';

export default async function kids(printer: ThermalPrinterLike, data: ReceiptData): Promise<void> {
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
  if (data.competitor.club !== null && data.competitor.club.length > 0) {
    printer.println(data.competitor.club);
  }

  // Skogis bitmap — kids-svg-to-bitmap.ts uses skogisFromInput +
  // descriptorToSvgString + sharp to produce a PNG buffer; printImageBuffer
  // emits the raster command sequence to the ESC/POS device.
  try {
    const bitmap = await generateKidsBitmap({
      card_number: data.competitor.card_number ?? 0,
      name: data.competitor.name,
      club: data.competitor.club,
      class_id: data.competitor.class_id,
      status: data.competitor.status,
      // For Phase 1 the route handler resolves place + place-context; the
      // skogis generator needs starters-in-class + control / leg counts to
      // populate FART/STIG/KART. We rely on the envelope's skogisStats for
      // the printed stat grid (below) and pass a sensible default chain
      // here for the descriptor's identity hash (which only depends on
      // card_number + name + club + class_id anyway).
      place: data.placeContext.place,
      control_count: data.competitor.latest_punches.length,
      best_legs: 0,
      total_legs: Math.max(1, data.competitor.latest_punches.length),
      starters_in_class: Math.max(1, data.placeContext.class_rows.length),
    });
    await printer.printImageBuffer(bitmap.png);
  } catch (err) {
    // If sharp / libvips isn't available at runtime (dev box without
    // native deps) we still print a friendly placeholder so the receipt
    // emits something rather than crashing the whole print pipeline.
    printer.println(`[Skogis: ${(err as Error).message}]`);
  }

  // W-3 LOCKED: read stats from envelope.data.skogisStats. NO second
  // skogisFromInput call inside the template.
  const stats = data.skogisStats;
  printer.println(`FART ${stats?.fart ?? '—'}  STIG ${stats?.stig ?? '—'}`);
  printer.println(`KART ${stats?.kart ?? '—'}  TUR  ${stats?.tur ?? '—'}`);
  printer.drawLine();

  printer.println(
    data.competitor.status === 'OK' && !data.competitor.no_timing
      ? `Tid: ${formatElapsed(data.competitor.elapsed_time_ms)}`
      : receiptTime(data.competitor)
  );
  if (data.placeContext.place !== null) {
    printer.println(`Plats ${data.placeContext.place} av ${finishedInClass(data)}`);
  }
  printer.println('Spara kvittot — skogisen är din!');
}
