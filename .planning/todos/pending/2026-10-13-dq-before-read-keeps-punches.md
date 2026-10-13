---
created: 2026-10-13T12:40:00+02:00
title: A DQ set before the read-out keeps the punches, a DQ set after it does not
area: projection
files:
  - apps/edge/src/projection/reduce.ts
  - apps/edge/scripts/walk.test.ts
  - apps/edge/scripts/walkChecks.ts
---

## Problem

The same runner, the same read and the same DQ give two different views,
depending on which came first:

- DQ set by hand, then the read-out: the status stays DQ (a read does not
  re-score a DQ) and the view keeps the read's punches (`latest_punches`).
- Read-out, then DQ: `manual_status_set` empties `latest_punches`, so that
  a receipt does not show a punch analysis for a disqualified runner
  (`reduce.ts`, the DQ arm).

So "Ta bort status" followed by the same DQ again does not give back what
was there: the punches are gone from the view. Nothing is lost in the log,
and the status and the result list are the same; what differs is what the
receipt and the read-out card show for that runner.

Found by the operator-mistake walker on 2026-10-13 (seed 20, 250 steps,
check 5 `way-back-differs` after `clear-status`), when a new step changed
the walks. It has nothing to do with card numbers. A todo test through
the plain routes is in `apps/edge/scripts/walk.test.ts`, and the walker
lists it as known (`KNOWN` in `walkChecks.ts`).

## What

Decide which of the two is right and make the reducer give it in both
orders: a read that arrives while a DQ stands should leave the view as a
DQ set after the read does. It is a change in `projection/`, so the two
competition days are replayed before it is merged (ADR-0014).

## Done when

The todo test passes without `todo` and the `KNOWN` entry is removed.
