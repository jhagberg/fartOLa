---
created: 2026-10-10T18:40:00+02:00
title: Kvar i skogen from radio punches too, not only the check unit read over USB
area: edge
files:
  - apps/edge/src/routes/checkunit.ts
  - apps/edge/src/routes/radio.ts
  - apps/edge/src/integrations/roc/status.ts
  - apps/web/src/routes/competition/[id]/kvar-i-skogen/+page.svelte
---

## Problem

Kvar i skogen today has one source: the BSF8 check unit's backup memory,
read over the coupled mini reader (`POST …/checkunit/snapshot`). The
list is "checked in at the start" minus "has a finish punch". It needs
someone to carry the check unit to the secretariat and read it.

When the check and start units (or other controls) are radio controls,
their punches already arrive through ROC (`radio_punch` events,
`competitions.roc_check_codes` / `roc_start_codes`, and the speaker reads
them too). A runner seen at the check, the start or any radio control
has left for the forest, even if the check unit's own transmission was
missed or the unit was never read.

## Fix

- Build the "left for the forest" set from every source: the check-unit
  snapshot, radio punches at a check or start code, radio punches at
  any other control on the runner's course, and a start punch in a card
  read. Show the source per runner (Check-enhet, Radio K71, Avläsning).
- "Returned" stays: a card read with a finish punch, a manual finish
  time (sekretariat) or status set by hand (Ej start, Utgått).
- A runner with a radio punch but no check punch is still in the forest;
  flag "ingen checkstämpling" so the start crew can look at it.
- Work without a reader connected: radio data alone gives a list.
- Show when each source was last updated (ROC link status, time of the
  last check-unit read).

TR 4.22.1: the organiser must know that all who started are back before
closing. Test: a runner seen only at a radio control, not at the check,
is listed as in the forest; a runner with a finish read is not.
