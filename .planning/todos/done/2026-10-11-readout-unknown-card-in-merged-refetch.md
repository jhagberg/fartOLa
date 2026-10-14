---
created: 2026-10-11T00:00:00+02:00
title: Readout: an unknown first card in a two-read refetch, and a failed newest refetch
area: web
files:
  - apps/web/src/lib/screens/ReadoutView.svelte
---

## Problem

1. Two reads arrive within one refetch and the first is an unknown card: the
   walk-up does not open for it, because it checks the top of the merged
   history.
2. If the newest refetch fails, an older good answer is dropped until the next
   event.

Found in the design-lab plan 3 reviews, 2026-10-11.

## Idea

Check each new read, not only the top of the merged history; keep the last good
answer when the newest refetch fails. Test both with mocked responses.
