---
created: 2026-10-12T00:00:00+02:00
title: Resultat screen in the style of the new liveresultat.orientering.se
area: results
files:
  - apps/web/src/lib/screens/ResultsView.svelte
  - apps/web/src/lib/components/ResultsTable.svelte
  - apps/web/src/lib/components/ClassTabs.svelte
---

## Problem

Jonas, local test 2026-10-12: the Resultat screen ("Liveresultat") should
look more like the new liveresultat.orientering.se (beta, `/beta/follow/<id>`).
Today it is one long list with tabs and the columns Plats, Namn, Klubb, Tid,
Status.

## What the reference does (observed 2026-10-12)

- **Class picker:** a grid of class buttons, then one tab per opened class
  (closable).
- **Table:** `#`, name with the club on a second line, start time, one
  column per radio control (time, place in brackets, and the gap to the
  leader under it), finish (time, place, gap).
- **Side by side:** a 1–4 column switch shows several classes at once.
- **Search** by runner or club; "Latest updates", "Still out on course",
  favourites.
- **Fresh results** (last two minutes) are marked.

## Idea

Take the parts that help a speaker or a results screen at the arena: the
class grid, name over club, start time, radio split columns with place and
gap (ROC punches are already stored), gap to the leader at the finish, and
2–4 classes side by side in fullscreen. Keep fartOLa's tokens and floors
(ADR-0016: 14 px, 44 px, never colour alone) rather than copying colours.
Needs its own plan; not a copy of their code.
