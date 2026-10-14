---
created: 2026-10-11T00:00:00+02:00
title: Tävlingsinfo reads the max-time lock from the edge
area: competition-info
files:
  - apps/edge/src/routes/_maxTime.ts
  - apps/edge/src/routes/competitions.ts
  - apps/web/src/lib/screens/CompetitionInfoView.svelte
---

## Problem

Max time locks at the first start (SOFT TR 4.21.2). The edge decides the lock
in `_maxTime.ts`: any `race_started` event, which survives a race reset, or a
first start time that has passed. The screen copies the rule from the
competition DTO (`race_started_at_ms`, which a reset sets back to null, plus a
start time ≤ `Date.now()` that is not reactive to time).

Two cases show the field as editable when the edge will refuse the save:

- after a race reset;
- a page left open past the first start.

The save then returns 409 `max_time_locked`, and only then does the screen
lock and say so. Found in design-lab plan 3, Task 9 review, 2026-10-11.

## Idea

- Return `max_time_locked: maxTimeLocked(db, id, Date.now())` in
  `GET /api/competitions/:id`, next to `closing`, and add it to the shared DTO.
- The screen reads it instead of copying the rule, and keeps the 409 fallback.
