---
created: 2026-10-14T12:30:00+02:00
title: Readout - a "red exit" for not-OK cards, a full card memory view, and missing punches from station backup
area: readout
files:
  - apps/edge/src/si/cardReadPayload.ts
  - apps/edge/src/privacy/retention.ts
  - packages/sportident/src/SiCard/types/ModernSiCard.ts
  - apps/web/src/lib/screens/
---

Two ideas from reading the OLA guide (readout logs around page 20, "Visa
rådata från brickinläsning" around page 32) and MeOS. They wait for the
OLA lab report: a simulated station feeds the same synthetic cards to OLA
and fartOLa (first/last start and finish punches, clear after start,
missing/extra controls) and logs which card blocks OLA reads. Design
after that, not before.

## 1. Red exit

MeOS has "Status inte OK (röd utgång)": readout runs without questions, a
card that is not OK gets its own sound, and the runner is sent to a
separate desk where the secretariat sorts it out. The queue at readout
keeps moving.

- What counts as not OK: missing control, unknown card, no start time,
  and the SIAC first/last differences from
  `2026-10-13-sportident-answers-follow-up.md` (item 1, steps 2-3).
- A queue on the secretariat screen with the reason per card, cleared
  when handled. Check what the readout history and design-lab's
  `preRaceCheck` (not on main yet) already give before adding anything.
- Sound or signal at readout, distinct from OK (MeOS has a separate
  sound file setting for it).
- Compare with what OLA's readout log shows (lab report).

## 2. Full card memory view ("nerd mode")

A toggle in the read detail that shows the whole card memory as a hex
dump, with each field coloured and named: card number, punch records,
start/finish/check/clear, the SIAC reserve records (0x1B8, 0x1D8,
0x1DC), the block 1 codes (0xA5/0xA9), firmware (0x1C2). OLA's raw-data
view shows its interpretation only; this would show the bytes and our
reading of them side by side, which is what you want when a card and
the result disagree.

- Today the card_read payload keeps the decoded result, not the raw
  pages. Storing them means adding the pages read to the payload
  (`cardReadPayload.ts`), raw as read, gaps marked.
- **Personal data:** SI10/SI11/SIAC keep the owner's data in block 0
  (card holder, from 0x20: name, and on many cards address, phone,
  e-mail, birth date). It is whatever the card owner programmed, may
  belong to someone other than the runner (borrowed or hired card), and
  we do not need it. Blank those bytes before they reach the event log,
  which is append-only and is not scrubbed by retention.
- Related gap that exists already: card_read payloads carry
  `card_holder` today, and `retention.ts` leaves event payloads alone
  (see its header). Decide here whether to drop or redact it too.
- Layout facts come from SPORTident's data structure document and
  Thomas's answers; cite them, never copy the document.

Reference: the OLA guide (page 32) points users to SPORTident's
SI-Config+ for troubleshooting. Its card read shows every field of the
card, the SIAC reserve fields included, which OLA's own raw-data view
does not. That is the level to aim for. A lab with SI-Config+ (observe
only) would show how it lays the fields out.

## 3. Find a missing punch in a station's backup

The same page of the OLA guide describes the other half of that
troubleshooting: read a control's backup memory, look for the runner's
card, and if a valid punch is there, add it to the runner's punches.

- `packages/sportident/src/SiStation/readBackup.ts` already reads backup
  memory; today it is used only for the check unit's card numbers
  (`routes/checkunit.ts`, kvar i skogen).
- Wanted: read any station's backup (card, time), filter by card
  number, and from a missing control in "Ändra" offer the punch found
  there. Adding it is a decision with a reason (as in item 1 of
  `2026-10-13-sportident-answers-follow-up.md`), the station's record
  kept as evidence.
- Fits the red exit: the secretariat's queue is where a missing punch is
  looked up.

## Open

- Does the red exit need its own station role (a reader at the exit
  desk), or is it a filter on the existing readout screen?
- How much of the memory view belongs in the operator UI vs. a support
  export (a file the maintainer can open)?
