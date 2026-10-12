---
created: 2026-10-12T00:00:00+02:00
title: Speaker board - fill the time at a radio control from the card once it is read
area: speaker
files:
  - apps/edge/src/speaker/board.ts
  - apps/edge/src/routes/speaker.ts
---

## Problem

The speaker board takes a runner's time at a radio control only from radio
punches (`passingsOf` in `board.ts`). A radio link loses punches: on the day
the public speaker demo plays (`apps/web/src/demo/`), finished runners have a
radio time in 80 % of their radio-control cells (100 % at one control, 74 %
at the other two, where the radio was silent for about 25 minutes). The other
cells stay empty for the rest of the day, also after the card is read, although
the card holds the punch.

The speaker's old program on that day showed a time at every radio control for
every finished runner: it fills the passing from the card when the radio punch
was lost. With empty cells the places at a control are also wrong for the
speaker: a runner who passed first but whose punch was lost is not in the
ranking there.

## Idea

When a card is read, use its punch at each radio control of the course for the
passings that have no radio punch (same alignment to the course as the radio
punches get, same rounding to whole seconds). The radio punch wins when both
exist, so nothing the speaker already read out changes. Mark nothing in the
view: a time is a time. Needs the read's punches in the board input (today the
route passes only status, time and place), and a test with a lost radio punch
that the card fills. Results and statuses are not touched.

The demo shows it: jump to the radio outage and look at the finished runners'
K78 and K100 columns.
