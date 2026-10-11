---
created: 2026-10-11T00:00:00+02:00
title: Lost card with only a manual finish scores Felstämplad
area: edge
files:
  - apps/edge/src/projection
---

## Problem

A runner with a lost card and only a manual finish has no punches to check, so
the result is Felstämplad. SOFT TR 4.20.6 covers the time, not the punches.
Found in the design-lab plan 3 reviews, 2026-10-11.

## Question for Jonas

Should the edit dialog prompt for a manual status instead? Decide before any
change; this touches results (ADR-0011, replay needed).
