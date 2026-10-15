---
created: 2026-10-11T00:00:00+02:00
title: Splits that cross noon (SI5) or midnight can go negative
area: readout
files:
  - apps/web/src/lib/readout-types.ts
---

## Problem

`rawPunchesToReceipt` (readout-types.ts ~255) computes splits and cumulative
times from raw `seconds_in_half_day` with no half-day or modulo handling.
Splits that cross noon on an SI5 card (no PM bit) or midnight in an overnight
relay can come out negative. It feeds the readout card, the receipt mirror,
the edit dialog's splits table and the printed receipt. Found in the design-lab
plan 3 Task 11 re-review, 2026-10-11; it predates plan 3.

## Idea

Compute splits from epoch times placed the way the projection places them
(`cardClockToEpochMs`, anchored on the read time), or apply modulo 12 h / 24 h
per card type. Test with an SI5 card punching 11:58 → 12:03 and an overnight
relay leg 23:55 → 00:10.
