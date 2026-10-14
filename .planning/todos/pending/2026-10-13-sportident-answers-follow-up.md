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
clear), so the choice must be visible and changeable. The 2022 rulebook
says the same (5.5.2, 5.7.5). A question to SOFT asks whether they read
4.20.6 the same way.

Requirements (maintainer, 2026-10-14):

- **Keep the originals.** Keep the card's main and reserve records for
  start and finish, and the read-out's own data, when they exist. Never
  keep the card holder bytes of block 0 (personal data we do not need;
  see `2026-10-14-readout-red-exit-and-card-memory-view.md`).
- **Start.** In a start-punch class, the first valid start punch of this
  race. With a drawn start time, the drawn time, unless a recorded
  organiser decision changes it (TR 4.18.9). A start punch well after
  the drawn time in a class that has drawn times is a late start: flag
  it for review, never count it silently.
- **Finish.** The first valid finish punch of this race. A finish judge's
  decision goes before the punch: a time at the line (TR 4.20.4), and
  the finish order at a mass or chasing start (TR 4.20.8).
- **Valid** means: this race and day, after the clear and check, and for
  a start inside the class's start window.
- **Review.** Conflicting or unreasonable times are marked for review:
  first and last differ, finish before the last control, a start long
  after the drawn time.
- **Show why.** Show every candidate, which time counts and why. The
  secretariat can pick another candidate or enter a corrected time.
- **Audit.** Store who, when and why as a new event, never changing the
  originals (ADR-0003). Today "who" is the node and event code
  (ADR-0010); a person's name needs an operator name we do not have yet.
- **One decided time.** Results, lists and every export use the same
  decided time.
- **Re-reads.** A new read-out never silently removes earlier data or a
  manual decision. This is an invariant for the operator-mistake walker
  (read, correct the finish, read again: the decision stands).

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

## 4. Bench test with a real station and SIAC

What we know about the reserve records and the battery measurement on
read comes from documents, SPORTident's library on our own card images,
and simulated stations. One read with real hardware settles the rest.

- Equipment: a BSM8 in readout mode (extended protocol, handshake) and
  Jonas's own SIAC, with start and finish each punched twice after a
  clear (about 30 s apart), so reserve and main records differ.
- Record the serial traffic of a read by a program that measures the
  battery (it sends `EA` to page 0x7E, data `05 05 05 05`, the same
  bytes as SPORTident's library with battery measurement on, and MeOS).
  Wanted: the station's exact reply, and that block 3 is read after it.
- Read the same card with `fartola-readout --pretty`: `start_first` and
  `finish_first` match the first punches, the main records the last.
- Keep the capture with the other private captures; only the findings
  (and a synthetic fixture built from them) go into the repo.

Not documented by SPORTident, so nothing to build: a subsecond for
ordinary control punches, and what the code bytes hold after a clear.
