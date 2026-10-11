---
created: 2026-10-11T00:00:00+02:00
title: Stations for readout and direktanmälan, one screen per reader with an optional printer
area: readout
files:
  - apps/web/src/lib/screens/ReadoutView.svelte
  - apps/edge/src/si/bridge.ts
  - apps/edge/src/printer/
---

## Problem

Several readers at the finish share one readout screen and one receipt
flow. A volunteer at a reader must see that reader's newest card, and its
receipt must come out of the printer next to it. Today the screen follows
every read in the competition, and auto-print does not say which station
printed or whether the print failed (the edge logs auto-print failures to
stderr only).

Jonas, 2026-10-11, answering the design-lab plan 3 question about the
pinned read: "Om man sitter i utläsningen så ska man ju växla direkt till
nästa pinne. Det borde ju vara någon som sitter och övervakar varje skärm
och att man kopplat utläsningsenheter till skrivare så det blir enkelt att
förstå var ens kvitto kommer ifrån … Kanske man kan skapa ett antal
virtuella utläsningsskärmar där man kopplar skrivare till utläsnings-USB-
enheter på ett bra sätt, sedan kan man öppna dem på en laptop eller
mobiltelefon eller padda."

## Idea

- **Stations:** a "station" pairs one SI reader (USB position or bridge id)
  with one printer. It has a name ("Mål 1", "Mål 2") and is set up in
  Inställningar.
- **Screen per station:** `/competition/:id/readout?station=<name>` shows
  only that station's reads and prints there. It opens on a laptop, a
  tablet or a phone on the LAN.
- **Station names everywhere:** the receipt mirror and the print status
  say which station printed.
- **Auto-print failures** reach the station's screen as a WS event, so
  they are not silent.
- **Registration stations** (Jonas, 2026-10-11): "samma idé … fast man
  sitter i direktanmälan, men där behöver vi ingen skrivare (kanske om man
  får en vakant starttid så får man den på en lapp)".
  - A direktanmälan desk is a station with a reader, so a card scanned
    there opens the walk-up for that desk only.
  - The printer is optional. When the runner gets a vacant start time,
    the desk can print a small slip with name, class and start time.
  - Same station setup and the same `?station=` screen idea, for
    Registrering.

## Related

- `2026-10-05-browser-reader-client.md`, a reader in the browser.
- `2026-10-05-club-hardware-and-platforms.md`.
- ADR-0002, the three-tier architecture.
