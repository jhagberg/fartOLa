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
