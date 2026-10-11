---
created: 2026-10-11T00:00:00+02:00
title: Runner search dropdown reopens about 200 ms after it is closed
area: registration
files:
  - apps/web/src/lib/components/SmartRunnerSearch.svelte
---

## Problem

In the walk-up modal (Direktanmälan) the name-search dropdown opens again
about 200 ms after the volunteer closes it. Found in design-lab plan 3,
Task 4, 2026-10-11.

The club-filter `$effect` (SmartRunnerSearch.svelte ~220) reads `void clubId`
and also `lastQuery`, so it re-runs on every query change, not only on a club
change, and schedules a fetch whose result reopens the list.

## Idea

- Read `lastQuery` inside `untrack(...)` so the effect follows `clubId` only.
- Test: close the dropdown, then assert it stays closed after the debounce
  window has passed, using a held search route rather than a fixed sleep (the
  fetch should never be sent).
