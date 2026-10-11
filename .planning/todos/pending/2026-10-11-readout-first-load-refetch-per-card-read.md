---
created: 2026-10-11T00:00:00+02:00
title: Readout first load replays every card_read and each triggers refetches
area: web
files:
  - apps/web/src/lib/screens/ReadoutView.svelte
---

## Problem

On first load the readout replays every `card_read` event, and each one
triggers refetches, so a load costs O(N) requests for N reads. Found in the
design-lab plan 3 reviews, 2026-10-11.

## Idea

Do not trigger refetches for replayed history: fetch once after the replay,
or only refetch for reads newer than the load. Test with many stored reads and
count the requests.
