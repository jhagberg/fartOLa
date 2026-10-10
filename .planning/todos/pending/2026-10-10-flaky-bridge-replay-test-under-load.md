---
created: 2026-10-10T11:00:00+02:00
title: SI bridge replay test 1 misses its card_read under heavy load
area: tests
files:
  - apps/edge/src/si/bridge.test.ts
---

## Problem

`si/bridge.test.ts` › "SI bridge — offline PlaybackTransport replay
against Jonas fixtures" › `test 1: SI10 replay through bridge produces ≥4
events; card_read.punches.length > 0` failed once on 2026-10-10 in the
full `pnpm --filter @fartola/edge test` run (load average about 35,
several worktrees testing at once): `card_read row must exist`
(`actual: undefined`). Run alone it passes (17/17).

Likely cause: `replayFixtureThroughBridge` waits a fixed 80 ms
(`setTimeout(r, 80)`) after `pumpRemaining()` before closing the
station, and on a loaded machine the card_read insert has not happened
yet. Not a logic bug. A different flake from
`2026-10-09-flaky-max-time-route-test.md` and the liveresultat one.

## Fix

Wait for the card_read (poll the events table or await the bridge's
insert) instead of a fixed delay, then run the suite a few times under
load to confirm.
