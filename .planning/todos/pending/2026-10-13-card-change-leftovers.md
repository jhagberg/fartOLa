---
created: 2026-10-13T12:30:00+02:00
title: Card changes — what the fix of 2026-10-13 left
area: readout, import
files:
  - apps/edge/src/routes/_cardResult.ts
  - apps/edge/src/routes/import.ts
  - apps/edge/src/routes/competitors.ts
  - apps/web/src/lib/components/EnteredRunnerStep.svelte
  - apps/web/src/lib/components/CardRebindNotice.svelte
---

## Problem

`2026-10-12-card-change-drops-result.md` is fixed: no request takes a
runner's result away in silence. These parts were left, none of them loses
a result:

1. **A card changed on the day, before the read-out.** A runner gets a new
   card at the start ("Byt bricka" or "Ändra") and has not read out yet.
   The start list imported again still gives the runner the file's old
   card. When the runner reads out, the new card is an unknown card and
   the operator binds it again. The import's card change is now an event
   and its undo puts the card back, but the import could leave such a
   card alone and list the row, as it does for a runner with a result.
   It needs to tell a card set by hand from one set by an import.
2. **"Byt bricka" and the undo of a card change cannot confirm in
   place.** When the runner has a result they refuse and say that the card
   is changed under Anmälda, Redigera, where the warning has its own
   button. A confirm step in these two places is screen design
   (ADR-0016). It is felt most by a runner set to DNS by hand who then
   reads out with another card than the entry has: the read would replace
   the DNS, so "Byt bricka" refuses and the card is changed under
   Redigera.
3. **No screen imports a start list.** `POST …/import/startlist` is used
   by the replay script and by tests only. When a screen is built it must
   show `cardsKept` (the rows whose card was left, and why) next to
   `cardUpdates` and `skipped`.
4. **"Ändra" to no card writes no event.** A card number that is cleared
   is a changed row only; a new number is a `card_bound` event with the
   previous number.
5. **Reads since a card change are found by `local_seq`**, which orders
   the events of one node. It needs another rule when edges sync with
   each other (ADR-0004).
