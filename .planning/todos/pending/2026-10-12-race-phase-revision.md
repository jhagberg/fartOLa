---
created: 2026-10-12T17:30:00+02:00
title: Race phase — one revision that start, reset and undo requests must name
area: race-phase
files:
  - apps/edge/src/routes/competitions.ts
  - apps/edge/src/routes/_resetUndo.ts
  - apps/web/src/lib/layout/RacePhaseControl.svelte
---

## Problem

PR 130 (reset guard and undo) ties each confirmation to what the operator
saw with a check of its own:

- the screen drops a confirmation when the active competition changes;
- a reset names the start it was confirmed for (`started_at_ms`,
  409 `start_changed`);
- an undo names the reset it was confirmed for (`node_id` + `local_seq`,
  409 `undo_changed`).

One case is left open, found by the last Codex review of the PR and
checked by hand on 2026-10-12: an undo puts back exactly the start the
reset removed, so the body of that forced reset is valid again. Forced
reset for start T, undo, the same forced-reset body sent again (a delayed
request, or a retry after a lost answer) → 201, the race is reset again
and the runners go back to waiting for read-out, with no new confirmation.

It is tolerable because the second reset records its own `took` and is
offered for undo like the first, and the undo restores the same start. It
is still a reset nobody confirmed.

## Idea

Give the race phase a revision that changes on every start, reset and
undo (a counter on the competition row, or the `local_seq` of the latest
race-phase event). Send it with the competition, require it on start-race,
reset-race and reset-race/undo, and refuse a request that names an older
one. That replaces the three checks above with one, and closes the case
above: after the undo the revision is another one.

For a repeat of a request whose answer was lost, an operation id from the
client would let the edge answer "already done" instead of "changed".

## Notes

- The revision is route and screen state, not scoring: `reduce.ts` does
  not need it, so no ADR-0014 replay.
- Keep the 409 bodies the screen already handles (`reads_since_start`
  with the count), or change screen and route together.
- Also seen in PR 130 and not changed: a card read in the same millisecond
  as `race_started` but ordered before it is scored live (the cached
  column is seeded) and not on a replay from events alone. That one is in
  `reduce.ts` and does need a replay.
- The operator-mistake walker (`apps/edge/scripts/walk.ts`) finds the open
  case (forced reset, undo, the same forced reset again) and the
  same-millisecond read, and lists both as known (`walkChecks.ts`: `KNOWN`
  and `SAME_MS`). Remove the entries with the fix; the walk then guards it.
