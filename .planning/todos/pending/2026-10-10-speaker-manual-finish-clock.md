---
created: 2026-10-10T11:00:00+02:00
title: Speaker events strip — use the manual finish time once it exists
area: edge
files:
  - apps/edge/src/routes/speaker.ts
---

## Problem

The events strip shows when a runner finished. `routes/speaker.ts` takes
the finish punch of the latest read, else start + running time. The
secretariat track adds `manual_finish_ms` and a time addition to
`CompetitorView`; a runner with a manual finish and no read then falls
back to start + running time, which a time addition moves.

## What

After the secretariat branch is merged: prefer `manual_finish_ms`, then
the finish punch, then start + running time − the time addition.

## Tests

- A manual finish without a read: the finish event is at the manual time.
- A time addition does not move the finish event's clock time.
