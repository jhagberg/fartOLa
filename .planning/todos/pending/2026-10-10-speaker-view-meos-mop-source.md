---
created: 2026-10-10T10:00:00+02:00
title: Speaker view — use MeOS (MOP) as source when MeOS is the main system
area: web
files:
  - apps/edge/src/integrations/meos/mop.ts
  - apps/edge/src/speaker/
---

## Problem

The speaker view (todo `2026-10-07-speaker-view.md`) reads finishes from
fartOLa's own card reads and radio passings from ROC. When MeOS is the
main system (ADR-0007), fartOLa reads no cards, so the finish column
stays empty; radio passings still come from ROC.

MOP carries what is missing: `<base st rt stat>` per runner (start,
running time, status) and `<radio>` per runner (mop.xsd line 340), plus
each class's radio controls (`<cls radio="67,150">`) and control names
(`<ctrl>`). The MOP receiver stores `st`/`rt`/`stat` in
`meos_competitors` but drops `<radio>`, `cls@radio` and `<ctrl>`.

## What

- Finish from `meos_competitors.running_time_tenths` + `status_code`
  when the projection has no result for the runner (match on card
  number, as the auto-merge does).
- Optionally store MOP `<radio>` times (needs a schema column, so one
  migration) for competitions without ROC.

## Tests

- A MOP diff with `rt` and `stat=1` shows the runner as finished with
  place and time behind.
