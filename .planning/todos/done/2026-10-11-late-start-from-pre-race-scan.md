---
created: 2026-10-11T00:00:00+02:00
title: Late and early start are computed from a pre-race scan for lost-card runners
area: results
files:
  - apps/edge/src/projection/reduce.ts
---

## Problem

The projection's late/early-start loop (reduce.ts ~598-611) takes
`card_read_history.at(-1)` with no race-phase check. A pre-race identity scan
(made at the desk or at Kontroll before the race starts) stays in
`card_read_history` but is not a read-out, and it often carries last week's
punches.

For a lost-card runner (a manual finish, SOFT TR 4.20.6, and no read-out), the
lost-card post-pass (reduce.ts ~557-578) moves the runner off PEND, and the
loop then sets `late_start_ms` / `early_start_ms` from that old scan. The
`missing_start` check in the same loop also runs `startMs` on the scan.

Reproduced in the design-lab plan 3 Task 11 re-review (2026-10-11): a pre-race
SI10 scan at 08:30 with a 09:00 start punch from an old race, drawn start
08:00, race started 08:45, manual finish 09:20 → `late_start_ms` 3 600 000.
This reaches the jury warnings, not only the edit dialog (which now hides it).

## Idea

Use the same race-phase gate as `enteredRunners.readOut`: only reads at or
after `race_started_at_ms` count. Changes results/warnings → needs the
two-day replay (ADR-0014) and a projection test.
