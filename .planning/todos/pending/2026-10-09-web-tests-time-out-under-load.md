---
created: 2026-10-09T09:00:00+02:00
title: Two web component tests time out when the full test suite runs
area: tests
files:
  - apps/web/src/lib/screens/CompetitionInfoView.test.ts
  - apps/web/src/lib/screens/LottningView.test.ts
---

## Problem

In `pnpm test` (all packages in parallel), these hit vitest's 10 s timeout
once on 2026-10-09 and pass when `pnpm --filter @fartola/web test` runs alone
(228/228 twice):

- `CompetitionInfoView.test.ts` › competition level › shows "Inte angiven"
  when unset and saves the chosen level; choosing none sends null
- `LottningView.test.ts` › LottningView (mounted) › shows the class kind, its
  status and the level; previews what the draw will do

Likely slow mounts under CPU load (edge tests run alongside), not a logic
bug. CI may hit it too.

## Fix

Find what takes seconds in those two tests (waitFor loops, real timers,
large fixtures) and make them fast; raise the timeout only for a stated
reason. Then run the full suite a few times in a row to confirm.
