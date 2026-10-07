---
created: 2026-10-05T11:30:00+02:00
title: A cheap kit clubs can buy (Raspberry Pi), a Bun spike on it, then Mac/Windows
area: platform
files:
  - apps/edge/src/print/cups-sink.ts
  - packages/sportident/src/bin/fartola-readout.ts
  - docs/index.html
---

## Problem

Today the edge server is only tried on an Ubuntu laptop. Clubs should not
have to borrow laptops for a competition: the goal is a small kit a club
can buy once and keep in the club box. ADR-0006 already names a
Raspberry Pi 5 (4 GB) + UPS as the dedicated edge, but nothing has run on
one yet.

Mac and Windows support is wanted but not a priority. What blocks it now:

- Printing goes through CUPS (`lp`, `print/cups-sink.ts`): fine on
  Linux/Pi/Mac, absent on Windows.
- The reader defaults to `/dev/ttyUSB0`; Windows uses `COMn`, Mac
  `/dev/tty.SLAB_USBtoUART`/`/dev/cu.*`. `FARTOLA_DEVICE` overrides it,
  but nothing finds the port by itself. Windows needs the CP210x driver.

## What

1. **Raspberry Pi kit (priority).**
   - Run the full gate, a replay (DM dag 1 / Tuna Ting dag 2) and a bench
     readout + print on a Pi 5 (arm64 builds of `better-sqlite3`,
     `serialport`, `sharp`).
   - Measure: readout-to-result latency, battery time on the UPS / a
     power bank for a full competition day, Wi-Fi range of the Pi as an
     access point vs. a separate travel router.
   - Write a parts list (Pi 5, power/UPS, case, storage, BSM8-USB reader,
     receipt printer, router if needed) and an install path (an image or
     a one-line script), then put the kit on the site.
2. **Bun spike on the same Pi (time-boxed, ½–1 day, on a throwaway
   branch).** ADR-0006 (2026-10-07 matrix) keeps Node because serialport
   and SQLite on Bun are unproven; Bun's one real gain is a single
   executable for the club kit (`bun build --compile` embeds `.node`
   files, linux-arm64 supported). Three steps, each answers one question:
   - Run today's built edge with `bun` instead of `node` and replay DM
     dag 1 / Tuna Ting dag 2 (expect 633/634 and 608/609). Does
     `better-sqlite3` load, or is `bun:sqlite` (`drizzle-orm/bun-sqlite`,
     touches `db/index.ts` and `db/migrate.ts`) needed?
   - BSM8-USB on Linux, then on the Pi 5: read SI5/SI10/SIAC cards and
     print a receipt (Skogis bitmap too). Do `serialport` and `sharp`
     work? Run long enough to see reconnects after unplugging.
   - `bun build --compile` for linux-arm64 with the XSD and wasm assets
     embedded; run the single file on a clean Pi.

   Not in the spike: moving the 102 `node:test` files. Write down how
   much of `node:test` Bun runs as is. If all three steps pass, re-score
   the ADR-0006 matrix (hardware modules, club install) and decide; if one
   fails, record why in ADR-0006 and stop.
3. **Mac and Windows (later).**
   - Find the SI reader by USB vendor/product id (Silicon Labs CP210x) on
     every OS instead of a fixed path.
   - A printer sink without CUPS for Windows: raw ESC/POS over TCP 9100
     (network printers) or the USB device.
   - Run the gate and a bench readout on both.

## Tests

- Port detection picks the SI reader among several serial devices
  (fake port list per OS).
- Windows print path sends the same ESC/POS bytes as the CUPS path for a
  receipt fixture.
