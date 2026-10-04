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

## Open questions

- Exact gateway model and protocol (SH Radio Gateway → SIRAP / TCP?
  serial?). Does it send a heartbeat we can watch, so a silent link is
  noticed even when no runner passes?
- Threshold tuning: a quiet control late in the day must not page anyone.
