---
created: 2026-10-10T12:00:00+02:00
title: M3a start clashes - refuse or warn when classes on one course start the same minute
area: edge
files:
  - apps/edge/src/routes/lottning.ts
  - apps/web/src/lib/components/LottningView.svelte
  - .planning/compliance/soft-regelverk-2026.md
---

## Problem

TA till TR 6.5.1 / TR 7.5.3 (first paragraph): at interval start, classes
on the same course must not start at the same time, and classes starting
together with equal capacity should not share the first control. fartOLa
draws one class at a time (`routes/lottning.ts`) and never compares
classes, so the row is SAKNAS. ROADMAP M3a has it as "warnings first,
optimiser later".

OLA 6.6.2 (lab, 2026-10-10) has no automatic check either: D18 drawn on
the same course and first start as D21 Kort gave no warning.
"Fördela starttider" is a visual grid (rows by first control, course,
class; columns per minute; a row with starters per minute) where the
overlap shows but nothing is flagged or blocked.

## Fix

1. Draw route: after computing the class's start times, compare with the
   start times already drawn in other classes. The same course in the same
   minute gives 409 with the clashing class and minutes (the operator can
   override with a reason, which is logged); the same first control in the
   same minute gives a warning in the response.
2. A start-distribution view: per minute, the number of starters, grouped
   by first control and course, with clashes highlighted. Uses the
   classes' first start and interval before drawing, and the drawn times
   after.
3. Later (optimiser): suggest first starts per class that avoid clashes
   and even out the starters per minute.

Tests named after the rule rows; TR 7.5.5 (ranking classes on one course
start one after the other) joins once ranking exists
(`2026-10-10-ranking-gallring-reserve-list.md`).
