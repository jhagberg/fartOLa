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

## How MeOS and OLA do it (looked up 2026-10-12)

**MeOS** (source, `code/`): three independent boxes per class.

- "Fri starttid" (`FreeStart`): the draw skips the class
  (oEventDraw.cpp:1123, :2880), the start list shows a blank instead of a
  dash (oRunner.cpp:789), and the class is not reported as missing start
  times (oReport.cpp:396).
- "Boka starttid" (`RequestStart`): the runner books a start time; treated
  like free start by the draw and the report.
- "Ej startstämpling" (`IgnoreStart`): the start punch is ignored
  (oRunner.cpp:1226). Unticked, which is the default, a start punch on the
  card is the start time even when the runner has a drawn time.

So MeOS keeps two questions apart: does the class have a start list, and
does the start punch count. A drawn start list with timing from the punch
needs no setting at all.

**OLA** (OLA-guiden 1.2, FAQ-guide 2015, delivery notes 6.6.2; facts only):
one "startmetod" per class under the class parameters, with "stämpelstart"
as the choice for open classes; the Ö classes come predefined for free
start time and entry on the day. The guide's draw step says to draw the
classes that do not use start punch. From 6.6.2 an online start punch sets
the start time only for classes with stämpelstart. The guides do not show a
drawn start list combined with timing from the punch.

**fartOLa today:** one setting, "Starttid räknas från" (auto, start time,
start punch). Timing already allows a drawn list with timing from the punch
(draw the class, choose Startstämpling). But Kontroll reads the same setting
to decide whether the class needs start times: Startstämpling means never,
Automatiskt means yes as soon as one runner has a time. That is the
misleading part.

## Proposal (Jonas to decide)

Two questions per class, as in MeOS, and no "Automatiskt":

1. **Startlista:** "Lottas" or "Fri start". Kontroll lists runners without
   a start time only for "Lottas".
2. **Tiden räknas från:** "Starttid" or "Startstämpling".

| Startlista | Tid från       | Use                                         |
| ---------- | -------------- | ------------------------------------------- |
| Lottas     | Starttid       | age classes (forced at nivå 1-3, TR 7.4.2)  |
| Lottas     | Startstämpling | spread the start at a training race         |
| Fri start  | Startstämpling | open classes, inskolning (TR 7.4.3)         |
| Fri start  | Starttid       | not offered                                 |

Defaults by class kind (confirmed or guessed from the name): open and
inskolning get Fri start + Startstämpling; others Lottas + Starttid. The
operator can change either, also for a confirmed inskolning. Stored
`start_method` values keep their meaning (auto maps per runner as today
until the class is saved again), so old competitions score the same; the
change still needs the two-day replay.
