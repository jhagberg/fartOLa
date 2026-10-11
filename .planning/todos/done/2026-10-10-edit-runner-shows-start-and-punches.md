---
created: 2026-10-10T19:10:00+02:00
title: Edit runner dialog - show start, punches and splits, not only status and result
area: web
files:
  - apps/web/src/lib/components/EditCompetitorModal.svelte
  - apps/web/src/lib/components/CorrectionsPanel.svelte
  - apps/web/src/lib/components/PunchGrid.svelte
  - apps/web/src/lib/components/SplitsTable.svelte
---

## Problem

Seen 2026-10-10 testing main: the "Ändra" dialog (from Anmälda and the
readout) shows the runner's fields and, in "Rätta resultat", only the
status pill and the result. To correct a result the secretariat needs
to see why it is what it is: which start the time runs from, which
controls were punched and which are missing, and the read's times. MeOS
shows all of this on the runner tab.

## Fix

In the dialog, above "Rätta resultat":

- Start: the drawn start time, the start punch if any, and which one the
  time runs from (the class's "Starttid räknas från", TR 4.18.9 / 4.18.16),
  with the late-start warning if there is one.
- Finish: the finish punch or the manual finish time, and the read time.
- The course check: every control in course order, punched or missing,
  manual punches marked (reuse PunchGrid from the readout card).
- Splits (reuse SplitsTable), with time additions shown as a separate line
  and included in the total.
- Card number and whether it is a rental card; the latest read and how
  many reads the card has.

Reuse the readout card's components so both screens show the same thing.
Test: a mispunched runner shows the missing control; after a manual
punch it shows as punched by hand and the status is OK.
