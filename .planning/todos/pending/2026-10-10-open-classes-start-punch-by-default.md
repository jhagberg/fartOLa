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
  for classes that should be drawn. **Part 2, done in design-lab plan 3:**
  the link to Lottning per class. **Still open:** the "Fri start" button (a
  write that changes which start a result runs from; needs a replay).
- Lottning: move "Starttid räknas från" next to the class header, before
  the draw controls, and say what it means for this class kind.
  **Part 3, done in design-lab plan 3.**

Test: a confirmed open class with a few imported start times and the
rest without is not listed in Kontroll; a confirmed age class at nivå 1-3
still is (TR 7.4.2).

## Seen again, 2026-10-12 (Jonas, local test)

Inskolning showed up in Kontroll as missing start times until the class was
drawn. On "Automatiskt" the class counts as drawn as soon as one runner has a
start time (`classNeedsStartTimes`, preRaceCheck.ts), and then every other
runner is listed. In the test data "Vit 2,0" had 1 start time among 22
runners. The class kinds were not confirmed either (`class_kind` null for
"Insk. 2,0", "Vit 2,0"), so a default by kind must also work from the name
guess, or Kontroll must ask to confirm the kind first.
