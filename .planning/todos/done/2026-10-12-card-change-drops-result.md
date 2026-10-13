---
created: 2026-10-12T21:00:00+02:00
title: A changed card number takes a read-out runner's result away without a warning
area: readout, import
files:
  - apps/edge/src/routes/competitors.ts
  - apps/edge/src/routes/cardBinds.ts
  - apps/edge/src/routes/import.ts
  - apps/edge/src/projection/reduce.ts
  - apps/edge/scripts/walk.test.ts
---

## Problem

A read-out belongs to the runner who has that card number now
(`reduce.ts`, `cardIndex`). Four requests change the card number of a
runner who has already read out. Each one takes the result away at once:
the runner goes back to "not read out", the answer is a plain 200 or 201,
and nothing asks first.

1. "Ändra": `PATCH /api/competitors/:id/profile` with `card_number`
   (another number, or none).
2. "Byt bricka" at the read-out: `POST /api/competitors` with
   `replace_card_for_competitor_id`.
3. The undo of a card change, `POST …/card-binds/undo`, when the runner
   has read out with the new card since.
4. The start list imported again, `POST …/import/startlist`: a row that
   finds its runner by name and club takes over the card number in the
   file.

For 1 to 3 there is a way back (type the old number, undo, change again)
and one runner is hit. The fourth is the one to fix first. It can hit many
runners in one click, the answer only says `card_updated: N`, no
`card_bound` event is written, and the start-time undo that takes the
import back restores start times only: card numbers and bibs stay as the
file had them.

The day it happens (made-up runner):

1. Alva Almfors, OK Granen, H21, is entered with card 8100001.
2. Her card fails. At the read-out she gets card 8300001 ("Byt bricka")
   and reads out: OK.
3. The start list is imported again, for a late change in another class.
   The file is from before the day and has her old card.
4. Alva has card 8100001 again and no result. Undoing the import's start
   times does not bring it back.

Found by the operator-mistake walker (`apps/edge/scripts/walk.ts`), checks
4 and 5. Each of 1, 2 and 4 is a todo test through the plain routes in
`apps/edge/scripts/walk.test.ts`, and the walker lists them as known
(`KNOWN` in `walkChecks.ts`).

## What

To decide; the pieces:

- 1 to 3: when the runner has a read-out on the card that is taken away,
  answer 409 with what would be lost and take the change only with a
  confirmation that names it, as the reset of a race does
  (`reads_since_start`). The screens show it before the change
  (ADR-0016).
- 4: the import does not take a card number from the file for a runner
  who has read out, or whose card was changed after the entry; it lists
  those rows in its answer instead. A card number it does change is
  written as a `card_bound` event with the previous number, so it can be
  undone like any other.
- Make the way back from a start list import whole: card numbers and
  bibs with the start times, or an undo of its own for the import.

## Done when

The three todo tests in `walk.test.ts` pass without `todo`, the `KNOWN`
entries that name this file are removed, and a longer walk still passes.

## Fixed 2026-10-13

The rule is written where it lives, `apps/edge/src/routes/_cardResult.ts`:
a runner who has a result keeps it.

- 1 and 2 ("Ändra", "Byt bricka"): 409 `has_result` with `lose_result`
  (the card, the card change that gave it, the status, the reads). The
  change goes through only when the request sends that `lose_result` back
  unchanged. "Ändra" shows the warning under the card field with its own
  button; "Byt bricka" refuses and says where the card can be changed.
- 3 (undo of a card change): takes back what the change attached; a read
  made with the new card since is the same 409. The notice refuses and
  says where the card can be changed.
- 4 (start list again): the import leaves the card of a runner whose
  result it would take and lists the row in `cardsKept`. A card it does
  change is a `card_bound` event with the previous number, and the
  import's `start_times_set` event records the cards and bibs changed, so
  the start-time undo puts back all of it. The undo is refused after a
  read with the import's card since.

Left for later: `2026-10-13-card-change-leftovers.md`.
