---
created: 2026-10-09T08:00:00+02:00
title: Mark changed start times in the start list (Ny tid, Efteranmäld, Omstart, Seedad)
area: draw
files:
  - apps/web/src/lib/screens/LottningView.svelte
  - apps/edge/src/routes/lottning.ts
  - apps/edge/src/db/startTimes.ts
---

## Problem

PR #77 (M1 draw package) listed text markers for the start list as UI
follow-up; the M1 UI (PR #84) did not build them. The start list in
LottningView shows name, club and start time only, so the operator cannot
see which runners got a new time by hand, were placed as late entrants,
start in the pursuit's restart block, or are seeded. Printed and pushed
start lists cannot show it either.

## What

- Per runner, a text marker (not colour alone, ADR-0016 rule 7):
  "Ny tid" (start changed by hand after the draw), "Efteranmäld" (placed by
  a late-entrant draw), "Omstart" (pursuit restart block), "Seedad" (with
  its group).
- The facts are in the start_times_set events (cause per change) and on
  the runner (seed_group, input_status); GET lottning returns what the
  markers need.

## Done when

Target M2. The start list shows the four markers in text, with a test per
marker, and the screen follows ADR-0016.
