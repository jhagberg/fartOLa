---
created: 2026-10-04T14:10:00+02:00
title: Radio controls — warn when a radio link stops sending, and support it in fartOLa
area: readout
files: []
---

## Problem

On DM dag 2 (2026-10-04) radio control 78 (jSh.Radio Gateway, listened
to passively by MeOS) lost about 1 punch in 10 all morning, then
delivered nothing from 11:17 to 11:32. Nothing warned us; the misses were
seen by hand. After the transmitter was restarted and moved (≈11:27,
working again ≈11:33), 56 of 56 arrived. The card readout was always
right, so results were safe, but the live radio times were not.

Numbers (card punch at 78 vs. an oPunch Type=78 within ±2 s):

| Period          | Arrived by radio |
| --------------- | ---------------- |
| 10:00–11:13     | 262/290 (90 %)   |
| 11:17–11:32     | 0/98             |
| 11:33–11:36     | 9/13             |
| from 11:37      | 56/56 (100 %)    |

Arrival latency when it worked: median 1 s.

It was not only 78. Same method over every online punch type, both days:

| Day | Link        | Received     | Dead window (nothing arrived) |
| --- | ----------- | ------------ | ----------------------------- |
| 1   | finish (2)  | 441/596 74 % | 11:23–11:31                   |
| 1   | 52          | 36/182 20 %  | poor all day                  |
| 1   | 87          | 55/55        | —                             |
| 2   | finish (2)  | 438/564 78 % | 11:08–11:23                   |
| 2   | 100         | 424/562 75 % | 11:08–11:26                   |
| 2   | 78          | 345/470 73 % | 11:17–11:32                   |
| 2   | 31          | 325/326      | —                             |

Start (1) and check (3) also lost 10–20 % in the start rush on dag 2.
Finish and 100 died in the same minute on dag 2, so a shared receiver
or gateway is as likely as a single transmitter.

## What

1. **Watchdog (works with MeOS today).** Read the replica: per radio
   control, compare radio punches with what read-out cards say passed that
   control. Warn when
   - nothing has arrived for N minutes while runners are on the course
     (expected traffic from start times and earlier rates), or
   - the share of read-out card punches with no radio match over the last
     M minutes falls under a threshold (e.g. 80 %).
   Show it as a light in a small web page (like kontroll/Skogis) and make
   a sound; later push to a phone.
2. **Native radio support in fartOLa.** Receive the gateway's punches
   directly instead of through MeOS, with the same health check built in:
   last-heard per unit, loss rate against readout, alert.

## ROC (roc.olresultat.se): punches hidden by a wrong date

On dag 2 MeOS's ROC input got no punches from one ROC sender. Not a
station clock: the SI stations' clocks were right (weekday byte in the
raw autosend frames = Sunday) and the card readouts were fine. The
"ClusterFriend" sender on ROC unit O-Ringen107 had its own system clock
≈18h50m behind, and it stamps each punch with *its* date + the SI time of
day, so rows were stored as 2026-10-03 with the right time of day. The
same SI record via sender "LivePunch" got the right date (ROC id 4596 vs
4597, byte-identical raw data).

MeOS asks `getpunches.asp?unitId=..&lastId=..&date=<competition date>
&time=<zero time>` (meos `code/onlineinput.cpp:521`) and the ROC server
filters `timestamp >= date+time`, so those rows never reached MeOS —
although MeOS itself reads only the time of day (`onlineinput.cpp:803`).
A local proxy (`~/roc-datefix/roc_datefix.py`, not in any repo) forced
today's date on rows with id >= a hardcoded min id and applied MeOS's
filter after that; MeOS polled it 09:56–12:02.

For native ROC input in fartOLa:

- Poll with `unitId` and `lastId` only (HTTP 500 without `lastId`);
  never filter by date on the server. Skip rows from before the
  competition by id (the first id of the day), not by timestamp.
- Use the time of day only and place it on the competition clock like
  card times (`cardClockToWallMs`). Times are local wall clock, no zone.
- A row whose date is not the competition date is a warning on that
  sender ("ClusterFriend O-Ringen107: date 1 day off"), never a silent
  drop.
- Deduplicate on (card, code, time of day) across sender types.
- Watchdog: per sender, the delivery delay (ROC's "Leveranstid från ROC"
  was ≈18h50m for the bad sender vs ≈0.5 s for LivePunch) and silence.

## More field lessons (October 2026)

- Radio reception into MeOS from a jSh receiver broke when the operator
  switched to another SportIdent function in MeOS. fartOLa should
  receive radio in its own process, independent of any screen.
- jSh transmitters and receivers need the antenna mounted vertically.
- SportIdent SRR radio controls must be programmed to send the last punch
  for SIAC Air+ to work touch-free: with touch-free the unit stores no
  punch, the card sends it, so contact and touch-free paths need separate
  tests.
- **Watch per physical unit, not only per control code.** Several units
  can share one code (e.g. two finish units). Each card punch and each
  radio punch carries the unit number (MeOS `@unit` / `oPunch.Unit`), and
  on day 1 one of two finish units delivered only 41 % while the other
  delivered 86 %. The watchdog should report coverage per unit ("mål,
  enhet 20: 2 av 21 senaste kvarten") so the faulty box can be found.
- **…and per card type.** That unit forwarded contact punches (87 %) but
  almost no SIAC punches (4 %) for two hours, until its setting was
  changed; then SIAC came through 18/18. A unit that forwards ordinary
  cards but not SIAC is a configuration error (touch-free not forwarded).
  The watchdog can flag it from read-out cards: card type comes from the
  card number range (`cardTypeFromNumber`).
- A club-owned radio set would let all of this be tested without
  race-day pressure.
## Status 2026-10-08 (branch feat/roc-input)

Done, for ROC input (roc.olresultat.se):

- [x] Native ROC input: `apps/edge/src/integrations/roc/` polls
  `unitId` + `lastId` only (never `date`/`time`), 5 s with backoff,
  `lastId` stored on the competition so a restart resumes. The baseline is
  by id only: on enabling, everything that exists is history (or a set
  start id), whatever its date.
- [x] Time of day only, placed like card times on the competition's fixed
  offset (ADR-0017); a row with another date is stored with `date_mismatch`
  and counted per control, never dropped.
- [x] Each ROC row stored once (`unit:row id`); the same punch via two
  senders is collapsed when read.
- [x] Watchdog (pure, `watchdog.ts`): last heard (receive time), delivery
  delay, coverage over the last 20 min (same card, ±2 s), silence (10 min),
  date-mismatch count, expected controls, SIAC vs other cards.
  `GET /api/competitions/:id/radio/status`.
- [x] Start, check and finish units: the radio code is mapped by role in the
  settings, and compared with the card's start/check/finish time from that
  unit (station code, decoded in `packages/sportident`), per unit and with
  the SIAC check per unit.
- [x] Settings (`PATCH .../radio/settings`) and a small status panel in the
  readout view; text plus symbol per control.
- [ ] Not done: sound/alert and phone push, speaker view (later task).
- [ ] Not done: per-sender delay ("Leveranstid från ROC"); ROC rows carry no
  sender name.
- [ ] Not done: jSh/SRR radio input (gateway model, protocol, heartbeat).
- [ ] Not done: tune thresholds on real data; prefill the control lists from
  the course file.

## Open questions

- Exact gateway model and protocol (SH Radio Gateway → SIRAP / TCP?
  serial?). Does it send a heartbeat we can watch, so a silent link is
  noticed even when no runner passes?
- Threshold tuning: a quiet control late in the day must not page anyone.
