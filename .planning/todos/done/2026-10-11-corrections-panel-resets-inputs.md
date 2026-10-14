---
created: 2026-10-11T00:00:00+02:00
title: CorrectionsPanel clears typed inputs when a card is read on the readout
area: readout
files:
  - apps/web/src/lib/components/CorrectionsPanel.svelte
  - apps/web/src/lib/screens/ReadoutView.svelte
---

## Problem

With the edit dialog open from the readout, every card read refetches the
competitors (ReadoutView ~460), so `competitor` becomes a new object. The
dialog passes `competitorId={competitor.id}` and the like, which Svelte 5
compiles to un-memoized getters, so CorrectionsPanel's effects
(~83-96) re-run and clear what the volunteer was typing (a manual punch,
a time). Found in the design-lab plan 3, Task 11 review, 2026-10-11; it
predates that task.

## Idea

Read the ids through `$derived` in CorrectionsPanel (as Task 11's
EditRunnerRead block does) so the effects re-run only when the id changes.
Test: open the dialog from the readout, type in a field, simulate a read of
another runner, and assert the typed text stays.
