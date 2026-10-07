---
created: 2026-05-24T21:30:00+02:00
title: Voided legs identified by control code — breaks on repeated controls
area: correctness
files:
  - apps/edge/src/projection/reduce.ts
  - apps/edge/src/routes/manual.ts
source: PR #35 Gemini + GPT-5.5 review (medium)
---

## Problem

`filterVoidedLegs` and `computeVoidedElapsed` identify voided legs by control
code. On butterfly/loop courses where the same control code appears multiple
times, voiding one occurrence removes ALL occurrences from the expected list
and `findIndex` always picks the first occurrence for elapsed subtraction.

## Proposed fix

Represent voided legs by course position index (order in the expected sequence)
rather than by control code alone. Update the `leg_voided` event payload, the
`voided_legs` array on CompetitorView, and the `computeVoidedElapsed` function
to use position-based identification.

## When

Phase 3+ when butterfly/loop courses are supported. Phase 2.1 courses are
linear with unique control codes.
