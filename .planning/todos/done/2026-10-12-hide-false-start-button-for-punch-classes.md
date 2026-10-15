---
created: 2026-10-12T00:00:00+02:00
title: Hide "Tjuvstart: 1 min" for classes timed from the start punch
area: corrections
files:
  - apps/web/src/lib/components/CorrectionsPanel.svelte
---

## Problem

The corrections panel offers "Tjuvstart: 1 min" for every runner. TR 4.18.14
gives the one-minute addition only where the start punch is not used. A
class that runs from the start punch (`start_punch` or `free_start`, ADR-0018)
should not offer it: the runner's time already counts from the punch.

## Idea

Hide the button when the runner's class is timed from the start punch. Keep
manual time addition (TR 10.4.2) as it is. Needs the class's `start_method`
in the panel's data.
