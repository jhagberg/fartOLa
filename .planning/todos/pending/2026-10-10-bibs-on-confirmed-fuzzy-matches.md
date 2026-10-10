---
created: 2026-10-10T12:00:00+02:00
title: Take the bib from the start list when a fuzzy match is confirmed
area: import
files:
  - apps/edge/src/routes/import.ts
  - apps/web/src/lib/api/client.ts
---

## Problem

An imported IOF StartList sets the bib (`BibNumber`, SOFT TR 7.5.4) only on
exact matches (card, or name + club). A row matched by name + class waits
for the operator in `fuzzyMatches`; `imported.bibNumber` is already there,
but `POST …/import/startlist/confirm` takes only `{ competitorId,
startTimeMs }`, so the confirmed runner keeps no bib.

## What

- The confirm body carries the bib per match; the route writes it with the
  same rules as the exact path (one runner per bib, a bib another runner
  keeps is left out).
- The import screen sends it with the start time.

## Done when

A route test confirms a fuzzy match with a bib and finds it on the runner,
and a clash with another runner's bib leaves both unchanged.
