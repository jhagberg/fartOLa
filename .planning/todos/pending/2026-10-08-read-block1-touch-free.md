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

## Status (2026-10-08)

Done in code, awaiting a bench capture:

- `ModernSiCard.typeSpecificReadTouchFreeBlock` fetches page 1 when a start,
  finish or check record has PTD bit 7 and a real time, and page 1 is unread
  (an erased 0xEE record also has bit 7 set, so the time is checked). SI8/SI9
  read page 1 already; their zero-punch shortcut now respects touch-free.
- An erased block-1 byte (0xEE) decodes as "no code", not 238.
- Tests: `block1TouchFree.test.ts` (fake station). The strict replay
  harnesses (`bin/replay.ts`, `benchReplay.test.ts`, edge
  `cardReadPayload.test.ts`) answer the one unrecorded page-1 request with an
  erased page, so `siac-jonas-001` (recorded before block-1 support) replays
  unchanged and still shows `touch_free` without a code.
- Research: no public SportIdent document gives the bit 7 / block 1 layout
  (PC Programmer's Guide is on request only); it rests on MeOS
  `SportIdent.cpp:1366,1929`.

Still needs real hardware: record `siac-jonas-002` (touch-free SIAC Air+
finish, with the `FF 02 EF 01 01 ...` request) and confirm the unit code at
0xA9 (and 0xA5/0xA1), bit 6 handling, check-record behaviour; then add the
fixture and drop the legacy reply from the harnesses once no fixture needs it.

## To confirm with SPORTident or a bench capture

Test expectations that rest on an assumption or on MeOS alone (tagged in the
tests; the SPORTident card data structure doc, provided on request, does not
cover them):

- Block-1 station codes at 0xA5 / 0xA9 / 0xA1 for a PTD bit-7 start / finish /
  check record: MeOS behaviour only (`SportIdent.cpp:1929`, 153 bytes after
  the record). The card sheet documents bit 7 only as the subsecond marker
  (CN = TSS) for start and finish.
- A bit-7 check record: MeOS applies the same block-1 lookup; the doc allows
  a subsecond only on start/finish. What bit 7 means on check is unverified.
- Bit 6 added (+256) to a block-1 code, and an erased block-1 byte (0xEE)
  meaning "no code": unverified (the doc says keep start/finish codes < 256).
- Ordinary punches with PTD bit 7 set: we keep CN as the code; unverified.
- Subsecond scale: the sheet's SI5/SI6 notes say "4 ms or 50 ms steps", the
  PC Programmer's Guide 5 says TSS is 1/256 s; we use 1/256 s for every card
  (`subsec_256`). Check against a bench capture with a known station time
  (`siac-jonas-001` finish: CN 117, plausible but not checked).
- SI6 start/finish with bit 7: FIXED. CN holds the fraction (SPORTident doc), so
  the station code is now undefined; no other location is documented and we
  do not guess one (`subsec.test.ts`).
- Block-1 audit (SI8/SI9/SI10/SI11/SIAC): no live-read gap found; see
  `block1Audit.test.ts`. Fields that read block 1: card holder 0x80-0x9F
  (SI10 family), the three station codes, SI8/SI9 punches at 0x88 / 0x38+.
