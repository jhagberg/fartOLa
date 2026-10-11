---
created: 2026-10-11T09:30:00+02:00
title: More ways to get punches in - station backup memory, SI online/SRR, MeOS
area: edge
files:
  - apps/edge/src/si/bridge.ts
  - apps/edge/src/routes/checkunit.ts
  - apps/edge/src/integrations/roc/poller.ts
---

## Problem

Today fartOLa gets punches from:
1. card reads at the USB master station (`card_read`);
2. ROC radio punches (`radio_punch`, `integrations/roc/poller.ts`);
3. the check unit's backup memory over the coupled mini reader
   (`checkunit/snapshot`, card numbers only, no times);
4. manual punches in the secretariat;
5. dev simulation (`/api/__dev/simulate-read`, `simulate-radio`).

From MeOS (MOP) fartOLa receives results and statuses, not punches.

## Ideas, to rank before building

- Backup memory of any station, not only the check unit: read a finish
  or control unit after the race to rescue a missing finish punch or a
  disputed control (with times), as SPORTident Config+ does. Store the
  times, not only card numbers, so kvar i skogen and the jury can use
  them.
- SI stations in online/autosend mode on USB (a control or finish
  station sending each punch as it happens), and SRR radio receivers:
  the same frames over serial, a second radio source next to ROC.
- SIAC beacons (air+) at the finish line through an online station.
- Import of punch files (IOF or CSV from another program) for a
  competition run partly elsewhere.

Each new source should land as its own event type with the source
recorded, and show in the punch log (`2026-10-11-punch-log-view.md`).
SPORTident facts only from SPORTident's documentation and our own
observations (see the repo's provenance rules).
