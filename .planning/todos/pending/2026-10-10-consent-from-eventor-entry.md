---
created: 2026-10-10T00:00:00+02:00
title: Imported entries get consent from the entry, at import time
area: edge
files:
  - apps/edge/src/ingest/entryImport.ts
  - apps/edge/src/projection/auto-bind.ts
  - apps/web/src/lib/components/ConsentConfirmationToast.svelte
  - .planning/compliance/soft-regelverk-2026.md
---

## Problem

Runners imported from Eventor (EntryList) start at
`consent_status = 'pending_first_read'` with `consent_at_ms = null`, and the
secretary must confirm consent at their first readout ("Bekräfta samtycke"
toast). But they entered through Eventor: SOFT TR 4.14.4 says consent arises
from the entry ("Genom anmälan samtycker deltagaren…"). The extra
confirmation is noise under time pressure, and the audit trail has no time
for these runners. Raised by Jonas 2026-10-10 while testing the design lab.

## What

- At import, set a consent status that says where it came from (for example
  `'entry'`, source Eventor or the IOF file) and `consent_at_ms` = the
  entry's `EntryTime` when the IOF XML has one (`PersonEntry/EntryTime`, not
  parsed today), otherwise the import time. Record which one it is.
- No "Bekräfta samtycke" toast for those runners. Walk-up entries keep
  `'explicit'` (the secretary ticks the box; it starts unticked, decided
  2026-10-10, audit WA-2).
- Decide with Jonas whether an IOF file import from another source than
  Eventor counts the same way (it is still an entry).
- Update the compliance matrix row TR 4.14.4 and REQ-PRIV-001 wording if the
  status names change.

## Tests

- Edge: importing an EntryList sets the entry consent status and a time
  (EntryTime when present, import time otherwise).
- Web: no consent toast for an imported runner's first read; still shown
  for any runner left without consent.
