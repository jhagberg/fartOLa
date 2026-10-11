---
created: 2026-10-11T09:30:00+02:00
title: Stämplingslogg - one view of every punch coming in, filtered by source
area: web, edge
files:
  - apps/edge/src/routes/radio.ts
  - apps/web/src/lib/components/RadioStatusPanel.svelte
  - apps/web/src/lib/screens/ReadoutView.svelte
---

## Problem

fartOLa keeps punches apart by source, as MeOS and OLA do, but there is
no single place to see them arrive:

- Card reads (`card_read` events: the card's own punch list) are what the
  results are built from. ReadoutView shows the latest reads.
- ROC radio punches (`radio_punch` events) are left out of the result
  projection (`projection/loader.ts:89`); the speaker view, kvar i skogen
  (#109) and RadioStatusPanel (counts per control, last heard, coverage)
  read them.
- Manual punches (`manual_punch_added` / `_removed`, secretariat).
- Check-unit backup reads, stored as card numbers on the competition
  (#109, `checkunit_cards`).

MeOS has the same split: `oCard` (card readouts, with PunchOrigin
original/manual, `oCard.h:143`) and `oPunch` / `oFreePunch` (radio and
online punches, `oFreePunch.h:36`). OLA (lab database, 2026-10-11) keeps
raw card reads in `RawDataFromElectronicPunchingCards` + `RawPunches`,
punches tied to a result in `PunchingEntries`, and radio/online split
times in `SplitTimes`.

Asked 2026-10-11: a view where all punches can be seen as they come in,
filtered on card reads, radio controls and so on.

## Fix

A "Stämplingar" screen (live over the results WebSocket):

- One row per punch: time, card, runner and class if known, control code,
  source (Avläsning / Radio K67 / Checkenhet / Manuell), and for a read
  the station position.
- Filters: source, control code, card or name, time window; counts per
  source and control.
- Unknown cards and radio punches that do not match a runner's course
  stand out.
- Backed by one edge route reading the event log by type, paged.

Related: `2026-10-11-more-punch-sources.md`.
