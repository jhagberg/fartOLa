---
created: 2026-10-11T00:00:00+02:00
title: One word for a manual punch on every screen and the receipt
area: wording
files:
  - apps/web/src/lib/components/PunchGrid.svelte
  - apps/edge/src/print/templates.ts
  - apps/web/src/lib/i18n/sv.json
---

## Problem

A punch entered by hand is called "manuell" on the punch tiles (PunchGrid,
`ro.manualPunch`) and on the printed receipt (`print/templates.ts` ~155
hard-codes it). The edit dialog's new start-and-punches block (design-lab
plan 3, Task 11, 2026-10-11) says "för hand". Both show on one screen, which
breaks the one-word-per-concept rule (ADR-0016).

Changing only the tile key would split the readout's receipt mirror from the
printed receipt, so it was left out of plan 3.

## Idea

Pick one word ("för hand" reads plainer) and change the tile, the receipt
mirror and the receipt template together, with the receipt tests.
