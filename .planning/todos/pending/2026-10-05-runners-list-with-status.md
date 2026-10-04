---
created: 2026-10-05T10:00:00+02:00
title: Runners list with status — filter on "saknar starttid", MP, not read out
area: web
files:
  - apps/web/src/lib/screens/RunnersListView.svelte
---

## Problem

The runners list only knows name, club, class and card (class chips and a
text search). It has no projection data, so the secretariat cannot ask the
everyday questions from the list: who has no start time, who mispunched, who
is not read out yet, who has a manual status.

## What

- Feed the list from the projection (same data as the results / readout
  views): status, missing_start, manual_status, elapsed, read-out yes/no.
- Filters: Saknar starttid, Felstämplad, Ej utläst, Manuell status,
  Utan tidtagning; counts on each chip.
- Row actions that already exist elsewhere: set start time, set status.
- Keep the list fast for 600+ runners (virtualised or paged), live via WS.

Related: "Fastställ saknade starttider" (02.1-14 Task 15) covers the
end-of-race batch; this is the general view.
