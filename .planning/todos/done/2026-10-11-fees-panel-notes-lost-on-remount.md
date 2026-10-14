---
created: 2026-10-11T00:00:00+02:00
title: FeesPanel row notes and errors are dropped when a class-kind save remounts it
area: web
files:
  - apps/web/src/lib/components/FeesPanel.svelte
  - apps/web/src/lib/components/ClassKindsPanel.svelte
  - apps/web/src/lib/screens/CompetitionInfoView.svelte
---

## Problem

A class-kind save remounts FeesPanel, so its per-row "Sparat" notes and
errors disappear. Rows marked `invalid` also survive a reload next to the
fresh values. Found in the design-lab plan 3 reviews, 2026-10-11.

## Idea

Keep the panel mounted across class-kind saves (or hold row state above it),
and clear `invalid` rows when fresh values load. Test a class-kind save with
a failed fee row on screen.
