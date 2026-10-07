---
created: 2026-10-08T15:00:00+02:00
title: Unknown card at readout — find the entered runner first, then rebind the card
area: readout
files:
  - apps/web/src/lib/screens/WalkupModal.svelte
  - apps/web/src/lib/components/SmartRunnerSearch.svelte
  - apps/edge/src/routes/competitors.ts
---

## Problem

A runner who is entered but runs with a new card (not updated in Eventor)
reads out as an unknown card. Today fartOLa then opens the walk-up
(direktanmälan) dialog, whose search covers Eventor's national runner
database, not the competition's own entries. Picking the runner there
creates a second competitor; the real entry keeps the old card and stays
"not read out" (and in "kvar i skogen"). The backend can already change a
competitor's card (`card_bound` event, `PATCH /api/competitors/:id`), but
nothing in this flow offers it. Seen at a competition in October 2026.

## What

On an unknown card:

1. **"Är det någon som är anmäld?" first.**
   - Ranked suggestions: entered runners who have not read out yet and
     whose class course matches the card's punches (the punch sequence
     nearly always identifies the course), ordered by match and by how
     well their start time fits the card's start/check time.
   - Search among this competition's entries by name and club.
2. **Pick → rebind.** Show before (ADR-0016): "Byt bricka för <namn>:
   <gammalt> → <nytt>". Confirm → `card_bound` event, the read attaches to
   that runner and the result appears without reading the card again.
   The change is logged; undo restores the old card.
3. **Only if not entered:** continue to direct entry with the Eventor
   runner-database search, as today.

Hired-card set membership (rental-card inventory todo) still applies: a
card from a rental set is marked hired when it is bound.

## Tests

- Unknown card whose punches match one entered, unread runner's course →
  that runner is the first suggestion.
- Rebind → one competitor (no duplicate), result attached, old card
  number in the log; undo restores it.
- Runner not entered → walk-up flow as before.
