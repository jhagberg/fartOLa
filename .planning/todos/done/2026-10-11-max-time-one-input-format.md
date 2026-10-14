---
created: 2026-10-11T00:00:00+02:00
title: Max time is typed in minutes on Tävlingsinfo and mm:ss on Lottning
area: web
files:
  - apps/web/src/lib/screens/CompetitionInfoView.svelte
  - apps/web/src/lib/screens/LottningView.svelte
---

## Problem

Competition max time (Tävlingsinfo) is entered in minutes; class max time
(Lottning) in mm:ss. Two formats for one concept. Found in the design-lab
plan 3 reviews, 2026-10-11.

## Idea

Pick one input format for both. Parsing decides what is saved, so test
carefully: round trip a stored value, odd input ("90", "1:30", "90:00"),
and that an unchanged field is never rewritten.
