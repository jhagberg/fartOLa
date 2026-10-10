---
created: 2026-10-10T11:10:00+02:00
title: Verify that Eventor invoices walk-ups from AssignedFee and Fee/Id in a ResultList
area: edge
files:
  - apps/edge/src/xml/iofExport.ts
  - apps/edge/src/routes/_resultListInputs.ts
  - apps/edge/src/routes/eventorPush.ts
  - .planning/compliance/soft-regelverk-2026.md
---

## Problem

M2 4b (`feat/m2-class-fees`) writes the fees fartOLa charged into the
IOF ResultList: per PersonResult an `AssignedFee` with `Fee type="Normal"`
(class fee) and `Fee type="Late"` (surcharge), each with `Fee/Id` =
Eventor's EntryFeeId when the class fees came from Eventor, and a
`ServiceRequest` with `Service type="RentalCard"` for a hired card. The
shape follows MeOS (`iof30interface.cpp:2838-2915`) and validates against
IOF.xsd.

That Eventor invoices clubs from these elements is Jonas's belief
(2026-10-10), not something we have seen. OLA carries Eventor's fee ids
through to the results for invoicing, which points the same way, but
Eventor's ResultList import is not documented on this point.

## What

- Push a ResultList (Eventor publish, `routes/eventorPush.ts`) to an
  Eventor test event with at least one walk-up: an adult with a surcharge
  and a hired card, and a youth in an open class.
- Check in Eventor whether the walk-up becomes an entry with the right fee
  (matched by `Fee/Id`), whether the late fee and card rental show up for
  invoicing, and what happens to a fee without `Fee/Id`.
- If Eventor ignores `AssignedFee` or wants another shape (for example
  `Fee/Id` with a `type` attribute, or the rental as an `AssignedFee`
  rather than a `ServiceRequest`), change the export and its tests.
- Record the outcome in the TR 4.12.4, TR 4.12.6 row of the compliance
  matrix.

## Tests

- Edge: the export tests in `xml/iofExport.test.ts` and
  `routes/export.test.ts` keep matching whatever shape Eventor accepts.
