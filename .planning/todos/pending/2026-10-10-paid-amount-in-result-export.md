---
created: 2026-10-10T23:30:00+02:00
title: Record fees paid on site and export PaidAmount, or Eventor bills the club again
area: edge, web
files:
  - apps/edge/src/xml/iofExport.ts
  - apps/web/src/lib/screens/WalkupModal.svelte
  - apps/edge/drizzle/
---

## Problem

Checked 2026-10-10 against Eventor's invoice 26226 to Stora Tuna OK for
Tuna Ting dag 2 (Eventor 54363): 27 entries, 2 610 kr. MeOS's database
for that day (replica `meos_20260929_184325_326`) has 28 Stora Tuna
runners with fees summing to 2 790 kr. The difference is exactly one
race-day entry in Blå 3,0, 180 kr, marked paid (Paid = 180) at the
table. The five other race-day entries (no Eventor entry, entered
2026-10-04, Paid = 0) are on the invoice, and so are three runners with
status Ej start.

So Eventor bills from the uploaded result file: each runner's
AssignedFee minus its PaidAmount. MeOS writes PaidAmount
(`iof30interface.cpp:2838-2860`, `writeAssignedFee`). fartOLa writes
AssignedFee but no PaidAmount (`iofExport.ts`: "fartOLa takes no
payments"), so a runner who pays at the table would be billed to the
club as well.

## Fix

- Direktanmälan: a "Betald på plats" choice (kontant/Swish) that stores
  the paid amount per competitor (and the card rental with it).
- IOF ResultList: `PaidAmount` inside each `AssignedFee`, as MeOS does;
  card rental paid with it goes in its ServiceRequest's fee.
- Hyrbrickor/kassa: a per-day list of what was paid on site.

Test: a walk-up who paid 180 kr exports AssignedFee 180 with PaidAmount
180; one who did not pay exports PaidAmount 0 (or none). Then confirm on
an Eventor test event (`2026-10-10-verify-eventor-invoicing-from-assigned-fee.md`).
