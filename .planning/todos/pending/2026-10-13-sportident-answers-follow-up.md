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

Status (2026-10-14): the library reads both records and the card-read
event carries them (`start_first`, `finish_first`, PR #137). The
projection still takes only the main records into the read history and
the result, so a runner who punches the finish twice gets the later
time, and nothing shows it.

The rules are decided in ADR-0019 (proposed) and REQ-EVT-CMP-012 to 016:
the first valid finish punch; the start source stays the class's start
choice (ADR-0018), with "the start punch" meaning the first valid one;
every available candidate kept with its own metadata; decisions as
events; the finish judge's order separate from times. SOFT says nothing
about reserve records as such: "first valid punch" is our application of
TR 4.20.6, and a question to SOFT asks whether they read it the same way.
The 2022 rulebook says the same (5.5.2, 5.7.5).

Steps, in this order (none changes a result before step 4):

1. Done in the library and the event. Still to do: each candidate's
   unknown or unread fields stored as such, and the card holder kept out
   of the event, neither bytes nor decoded text (`cardReadPayload.ts`
   `card_holder`; old events left alone).
2. The projection keeps the candidates per read. At the read-out and in
   "Ändra", show "Första mål", "Sista mål" and the one used, when they
   differ; the same for start. Results unchanged.
3. The secretariat can change the choice with a reason; the event names
   the read and the record. Build on the existing hand-entered finish
   decision (`manual_finish_set`). The finish judge's order is a
   separate decision (TR 4.20.8, rule matrix row SAKNAS today).
4. Then change the default, with the acceptance cases below as tests and
   the replay of both days (ADR-0014), on the maintainer's decision.

Acceptance cases (from a review of ADR-0019, 2026-10-14):

1. Each start choice: start time 13:00:00, first start punch 13:00:10,
   later one 13:00:20, finish 13:30:00. Check the source, the result
   and the fallback when there is no valid punch.
2. Start 23:59:50, finish 00:30:00 in one race; a read without check,
   and one without clear; an official allowing a late start outside the
   window.
3. First and last equal in whole seconds but with a different fraction
   or code; a reserve without a known code or mode; a reserve that is
   empty versus a block that was not read. Never confuse these.
4. A test finish punch before the race, then two finish passages: show
   only the candidates the card still holds; the true middle punch may
   be gone.
5. Read A, a manual finish decision, read B with other candidates, undo:
   the decision stands until withdrawn, then the automatic choice comes
   from the right read. Also after a rebuild and a race reset.
6. Two runners at a mass or chasing start whose punch times are in the
   other order than the finish judge's: places follow the judge without
   altered times. Also a dead heat.
7. Change the start time or the class's start choice after a read: start,
   finish, total, result list and export agree.
8. A card with owner text programmed: the stored event holds none of it,
   as bytes or as text.
9. Old events without reserve data keep today's behaviour, also when a
   later read adds reserve data.
10. The replay of both days and an explicit decision before the new
    default is used for results. The rule matrix lint does not replace
    the behaviour tests.

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
