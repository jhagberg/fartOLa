---
created: 2026-10-15T20:00:00+02:00
title: SIRAP input - radio punches from meshO Manager, WiRoc and jSh over TCP
area: radio
files:
  - apps/edge/src/integrations/radioserial/input.ts
  - apps/edge/src/integrations/roc/place.ts
  - apps/edge/src/bin/fartola.ts
---

## Why now

meshO offers 5 radio units (EU model) for a test. Its only documented way
out is meshO Manager forwarding radio punches as SIRAP (docs.mesho.live,
"Connecting meshO Prime and radios"); it has no ROC and no serial
autosend, so `--radio-serial` cannot read it. WiRoc and jSh also speak
SIRAP (WiRoc: one TCP connection per punch). One TCP input covers all
three, next to ROC and the serial input.

## The protocol (prior art: MeOS, `code/SportIdent.cpp:790-935`, mimicked, not ported)

- The sender is a TCP client; the receiver listens (MeOS default port
  10000, as meshO Manager's settings).
- A punch is 15 bytes, little endian: type u8 (0 = punch), control code
  u16, card number u32, day u32 (0 when unknown), time u32. MeOS reads
  the time as tenths of a second since its zero time; WiRoc sends tenths
  since midnight and day 0.
- Type 64 with time 0 is a whole card: code = number of punches (2-192),
  followed by that many 8-byte punches. Not needed for radio controls:
  refuse and count it.
- A sender may keep the connection open for many punches (MeOS's loop)
  or open one per punch (WiRoc). Both must work.
- No acknowledgement, no checksum, no heartbeat. A retry arrives twice.

## Plan

1. `apps/edge/src/integrations/sirap/input.ts`, shaped like the serial
   input: a TCP server on `--sirap-port <n>` (bound to 127.0.0.1 unless
   `--sirap-host` says otherwise; the LAN case goes through ADR-0010's
   trust model first). Each punch is stored as a `radio_punch` on the
   active competition with the same dedup key (control, card, time of day)
   and placed on the competition clock with `placeRadioPunch`. Never
   touches the projection, like ROC and serial punches.
2. A frame parser with its own tests: split and joined frames on one
   socket, a frame cut by a closed socket, type 64 refused and counted,
   time over 24 h refused, code 0 refused.
3. Status for the radio panel: listening or not, connections, punches
   stored, duplicates, refused frames, last punch time; the watchdog sees
   SIRAP punches like the others.
4. Bench: the meshO lab (`fartOLa-docs/mesho-lab`) forwards punches it
   gets through its API to fartOLa's port; record the bytes and compare
   (date, tenths, codes over 255). WiRoc and jSh when units are borrowed.
5. Later, only on demand: SIRAP out, so fartOLa can feed MeOS during a
   migration (REQ-STD-006/007).

Done when meshO Manager's "Forward Radio Punches" lands punches in
fartOLa's radio panel, speaker and kvar i skogen, duplicates once, with
the parser tests above. Synthetic data only.

## Open

- Does meshO send the day, and what zero time does it use for the time
  field? Answered by step 4 or by the developer (`mesho-lab/QUESTIONS.md`).
