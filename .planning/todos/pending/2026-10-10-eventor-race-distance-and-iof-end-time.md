---
created: 2026-10-10T11:00:00+02:00
title: Prefill the distance from Eventor, and export the closing time as IOF Event/EndTime
area: eventor
files:
  - apps/edge/src/eventor/events.ts
  - apps/edge/src/routes/competitionsFromWizard.ts
  - apps/edge/src/xml/iofExport.ts
---

## Problem

`competitions.distance` (migration 0023, SOFT TA till TR 7.4.4) gives the
draw its suggested interval, but the operator has to set it by hand on
Tävlingsinfo. Eventor has the distance on each race
(`EventRace/@raceDistance`: Sprint, Middle, Long, UltraLong, ...), and
fartOLa does not parse `EventRace` today.

The closing time (SOFT TR 4.16.3, TR 4.22.1) is shown on Tävlingsinfo and
Lottning but not exported. IOF 3.0 `Event` has an optional `EndTime`
(date and time), the closest field; nobody we know reads it.

## What

- Parse `EventRace/@raceDistance` from the Eventor event, map it to
  `sprint | medel | lang | ultralang` (night races: Eventor's
  `lightConditions`, if it says night), and prefill `competitions.distance`
  when a competition is created from or linked to Eventor. Never overwrite
  a distance the operator set.
- Optionally write the closing time as `Event/EndTime` in the IOF
  StartList (and ResultList) export, on the competition clock and with the
  next day's date after midnight. Check `iofExport.ts` against m2-bibs'
  changes there first.

## Done when

A competition created from an Eventor sprint gets distance `sprint` (test
with a synthetic Eventor event fixture), and, if done, the StartList
validates against IOF.xsd with `EndTime`.
