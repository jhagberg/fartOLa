---
created: 2026-10-07T15:00:00+02:00
title: Rental cards — scan the box in the morning, reconcile at the end
area: readout
files:
  - apps/edge/src/routes/hiredCards.ts
  - apps/edge/src/db/schema.ts
  - apps/web/src/lib/screens/ActiveHyrbrickorView.svelte
---

## Problem

Lesson from a two-day competition in October 2026: nobody could vouch
that every rental card came back, including cards borrowed from another
club. Two places to miss a card: the "hyrbricka" box
not ticked at direct entry (then nothing marks it), and the red rental
notice overlooked at readout. Returned cards went back into the lending
box during the day.

fartOLa today: `hired_cards` per competition (card, marked/returned time,
contact, note), a list view, and a reminder at readout. It still relies
on someone ticking the box at entry.

## What

- **Morning inventory:** scan every card in the box (reader on the
  registration desk) into a named set, e.g. "Klubbens låda", "Lånade av
  <klubb>", with an owner per set. A card in any set is a rental card
  automatically: direct entry with that card marks it hired without a
  checkbox. Sets can be saved and reused next competition.
- **Readout:** a rental card shows a clear notice (text + symbol) and a
  one-click "mottagen"; if it is not confirmed, it stays on the open list.
- **Not lent twice:** a card returned today warns if someone tries to
  bind it again before the competition is closed (two boxes: out / in).
- **End of day:** reconciliation per set — returned, still out (with
  runner, class and contact), never lent. Printable and exportable, so
  the owner club gets a list.
- Optional: a colour/label per set, shown in the UI.

## Tests

- A scanned set card used at direct entry → marked hired, no checkbox.
- Readout of a hired card → notice; confirm → returned.
- Binding a card returned earlier today → warning.
- Reconciliation lists exactly the cards not returned, per set.
