---
created: 2026-10-13T15:00:00+02:00
title: What SPORTident's answers of 2026-10-13 let us build - first and last punch, contact or AIR+
area: sportident, readout
files:
  - packages/sportident/src/SiCard/types/ModernSiCard.ts
  - packages/sportident/src/siProtocol.ts
  - apps/edge/src/integrations/roc/watchdog.ts
  - apps/edge/src/projection/preRaceCheck.ts
---

## Background

SPORTident (Thomas, 2026-10-13) answered the open questions about SIAC
start and finish records. The reader already treats subseconds as 1/256 s,
reads the SIAC firmware version from block 3, treats 0x00 in the
block-1 code bytes as "code not available", and ignores TD bit 7 on
control records (codes 1 to 511).

## 0. Start and finish codes on SIAC 4.0+: always from block 1

This one is a correction, not an idea. Thomas wrote on 2026-10-09 that on
SIAC firmware 4.0 or later the start and finish codes are always read
from 0xA5 and 0xA9, and on 2026-10-13 that block 1 should always be
fetched. The reader does less: it fetches block 1 only when a start or
finish record has TD bit 7 (`needsBlock1`), and otherwise takes the code
from the record's own CN (`recordCode`). On SIAC 4.0+ it should always
fetch block 1 and take the start/finish code from 0xA5/0xA9, also when
bit 7 is zero. One more block per SIAC read-out; the mode byte in item 2
comes with it.

## 1. The first and the last start or finish punch

A SIAC keeps reserve records for clear, start and finish. The reserve is
written by the first punch of that kind after a clear and is not
overwritten; the main record holds the last one. If they differ, the
runner punched start or finish more than once. Which one counts is the
reader's decision.

Today fartOLa reads only the main record, so a runner who punches the
finish twice gets the later time, and nothing shows it.

Proposed rule (to be confirmed by the maintainer before it changes a
result):

| Situation                  | Time that counts                                       |
| -------------------------- | ------------------------------------------------------ |
| Finish punch               | the first valid finish punch of this race              |
| Drawn start time used      | the drawn time, by the class's start method, as today  |
| Start punch used           | the first valid start punch of this race               |

TR 4.20.6 (2026-07-01): time is taken when the runner "ends the race" by
punching the finish unit after the line, so a later finish punch is after
the race ended. TR 4.18.9: a runner late by their own fault keeps the
drawn time. SOFT says nothing about reserve records as such: "first valid
punch" is our application of the rule. "First after a clear" is not
always "first of this race" (a test punch, or a training lap without a
clear), so the choice must be visible and changeable.

Steps, in this order:

1. The library reports both records, unchanged, in the card-read event:
   time, fraction, station code and which record it came from. The
   projection chooses; the library does not.
2. At the read-out and in "Ändra", show "Första mål", "Sista mål" and the
   one used, when they differ; the same for start. Results unchanged.
3. The secretariat can change the choice with a reason, the raw records
   kept and the change undoable. Build on the existing hand-entered
   finish decision (`manual_finish_set`).
4. Then change the default to the rule above, with focused tests and the
   replay (ADR-0014). Reads stored before step 1 have no reserve data and
   keep today's behaviour.

Details: a missing reserve record means "first punch unknown", not "more
than one punch". Compare the two times before rounding, and across
midnight (half-day clock).

## 2. Contact or AIR+ for start and finish

For a start or finish punch the mode byte just before the code in block 1
tells a contact punch (0x03 start, 0x04 finish) from an AIR+ punch (0x33,
0x34). For ordinary controls no such field is documented.

The radio watchdog flags a unit that forwards ordinary cards but not
touch-free punches. Today it can only see that the CARD is a SIAC, not
that the punch was touch-free. With the mode byte it can be exact for
start and finish units.

- Read the mode byte with the code; add "contact or AIR+" to the start
  and finish of a card read.
- Use it in the watchdog's SIAC check for start and finish units.
- Needs block 1 on every SIAC 4.0+ read, which item 0 brings anyway.

## 3. Small checks

- Start and finish stations should use codes below 256. Say so where the
  start, check and finish codes of the radio units are entered.
- SI10, SI11 and SIAC store codes 1 to 511. A course control above 511
  cannot be stored on them: a line in the pre-race check.
- The header of `ModernSiCard.ts` still says "PTD bits 6-7 are code bits
  8-9"; the code uses bit 6 only. Correct the comment.

Not documented by SPORTident, so nothing to build: a subsecond for
ordinary control punches, and what the code bytes hold after a clear.
