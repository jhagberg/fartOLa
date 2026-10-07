---
created: 2026-10-08T12:00:00+02:00
title: Read card block 1 for touch-free start/finish/check station codes
area: readout
files:
  - packages/sportident/src/SiCard/types/ModernSiCard.ts
  - packages/sportident/src/siProtocol.ts
---

## Why

A touch-free (SIAC Air+) start, finish or check record has PTD bit 7 set.
Its station code is then not in the record's CN byte but in block 1 of the
card memory (0xA5 start, 0xA9 finish, 0xA1 check on SI8 and newer; MeOS
`SportIdent.cpp:1919`). The decoder already uses it, but the card read only
fetches page 1 when the card holder is incomplete, so on a typical SIAC read
the code stays unknown. A touch-free finish then lands under "okänd enhet"
in the radio watchdog instead of its unit (e.g. finish unit 20), which is
exactly the unit that dropped Air+ punches on 2026-10-03.

## What to change

In `ModernSiCard.typeSpecificReadCardHolder` (or a step after the basic
read): also fetch page 1 when the start, finish or check record in page 0
has PTD bit 7 set and page 1 has not been read. Nothing else changes; the
decoder picks the code up from storage.

## First

The strict bench replay (`tests/fixtures/jonas/*.bytes.hex`) fails on any
request not in the transcript. Record a new bench capture of a touch-free
SIAC read that includes the block-1 request (`siac-jonas-002`), then make
the change and add the fixture. The existing `siac-jonas-001` finish is
touch-free with an unread block 1, so it cannot be reused.
