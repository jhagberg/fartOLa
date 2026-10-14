---
created: 2026-10-11T00:00:00+02:00
title: CompetitionInfoView has two writers of `competition`
area: web
files:
  - apps/web/src/lib/screens/CompetitionInfoView.svelte
---

## Problem

The details PATCH reply and the max-time save both write `competition`. An
out-of-order details reply can show a stale max time. The max-time "Sparat"
note is not reset when the operator types again. Found in the design-lab plan
3 reviews, 2026-10-11.

## Idea

One writer (merge by field, latest request wins), and clear the note on
input. Test with a delayed details reply that lands after a max-time save.
