---
created: 2026-10-11T00:00:00+02:00
title: Importing an entry list twice duplicates runners without a card
area: edge
files:
  - apps/edge/src/ingest/entryImport.ts
  - apps/web/src/lib/screens/ImportRunnersView.svelte
---

## Problem

`entryImport` skips a runner already in the competition only when the
card number matches. A runner entered without a card (hired card, card
given at the start) has a null card number, so importing the same
Eventor event or EntryList file again inserts that runner a second time,
even though the entry carries the same Eventor person id. Found by the
Codex review of design-lab plan 2 (2026-10-10): the web side now retries
only the link after a failed relink, but any second import (a new
upload, "Länka om" after closing the sheet) still duplicates.

## What

- Dedupe on the IOF person id (Eventor `Person/Id`) when present, then
  on card number; fall back to name + class + club only if neither
  exists, and report those as "kunde inte avgöras" rather than inserting.
- Keep the import summary honest: "N hoppade över, redan importerade".

## Tests

- Edge: importing the same EntryList twice with a cardless runner
  inserts that runner once; a runner whose card changed between imports
  is updated, not duplicated.
