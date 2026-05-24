---
created: 2026-05-24T21:30:00+02:00
title: computeVoidedElapsed doesn't handle midnight/half-day boundary crossing
area: correctness
files:
  - apps/edge/src/projection/reduce.ts
source: PR #35 Gemini review (medium)
---

## Problem

`computeVoidedElapsed` calculates leg duration as `punchSec - prevSec`. If a
leg crosses a half-day boundary (SI cards use `seconds_in_half_day` which wraps
at 43200), the subtraction produces a negative value which the `legSec <= 0`
guard silently skips — no time is deducted for the voided leg.

Swedish orienteering races run 08:00–18:00 so this never triggers in practice,
but the fix is trivial: `(punchSec - prevSec + 43200) % 43200` (matching the
SI card half-day period, not 86400).

## Proposed fix

Apply modulo arithmetic: `const legSec = ((punchSec - prevSec) + 43200) % 43200;`
Also needs to account for `half_day` field transitions if both punches are
available with full HalfDayClock data.

## When

Low priority — defense-in-depth. Can be included in any cleanup pass.
