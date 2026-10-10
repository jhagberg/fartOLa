---
created: 2026-10-10T18:40:00+02:00
title: Open and inskolning classes should not need start times; make start punching easy to set
area: edge, web
files:
  - apps/edge/src/projection/preRaceCheck.ts
  - apps/web/src/lib/screens/LottningView.svelte
  - apps/web/src/routes/competition/[id]/kontroll/+page.svelte
---

## Problem

Seen 2026-10-10 testing main with DM lång dag 1: Kontroll listed 69
runners without a start time in Vit 2,0 and Insk. 2,0. Those are open
classes (TR 7.4.3: free start time), timed from the start punch. With
start method "Automatiskt", `classNeedsStartTimes` treats the class as
drawn when any runner has a start time (some came from the MeOS start
list), so everyone else in it is listed. Setting "Starttid räknas från:
Startstämpling" on the class fixes it, but the operator could not find
where: the field sits far down in Lottning, after the draw controls.

## Fix

- A class confirmed as öppen or inskolning defaults to start punching
  when its start method is "Automatiskt" (TR 7.4.3), unless it has a
  first start set (drawn on purpose).
- Kontroll: in the "utan starttid" list, per class, a button "Fri start
  (startstämpling)" that sets the start method, and a link to Lottning
  for classes that should be drawn.
- Lottning: move "Starttid räknas från" next to the class header, before
  the draw controls, and say what it means for this class kind.

Test: a confirmed open class with a few imported start times and the
rest without is not listed in Kontroll; a confirmed age class at nivå 1-3
still is (TR 7.4.2).
