---
created: 2026-06-01T15:30:00+02:00
title: Capture SIAC air+ beacon bit (and model byte) via probe --dump diff
area: sportident
blocked_by: needs bench time + units; partly superseded if SPORTident replies
files:
  - packages/sportident/scripts/probe-coupled-backup.ts
  - packages/sportident/src/SiStation/__fixtures__/station-info-captures.md
---

## What

Empirically locate the **SIAC AIR+ (beacon) config bit** — undocumented in every
reference we hold — by diffing a config dump of the same station with air+ ON vs
OFF. Same label-diff method that cracked serial (0x00) and mode (0x71). While
dumping, also locate the **model/firmware byte** (BSF8 vs BSF9), which my narrow
--info windows (0x00, 0x70) skip.

NOT urgent — deferred so Jonas can focus on testing the rest of phase 2.1.
A question was already sent to SPORTident (2026-06-01) asking for the beacon
register + an authoritative config map; if they reply, this capture may just be
confirmation rather than discovery.

## How (bench procedure)

Tool already built: `probe --dump` (read-only, GET_SYS_VAL 0x83 only).

1. Stop the edge server so the serial port is free.
2. Wake the unit (dip a card), place it on the mini reader.
3. From `packages/sportident/`:
   ```
   node --import tsx scripts/probe-coupled-backup.ts --dump
   ```
   (default range 0x00..0x80; widen with `--from 0x00 --to 0x100` if needed.)
4. Toggle AIR+ on that unit in SPORTident Config+ (or use a second unit you KNOW
   is in the opposite state), then `--dump` again.
5. Paste BOTH dumps + which is air+ on / off. The byte/bit that changes between
   them IS the beacon flag.

For the model byte: `--dump` the BSF9 (unit 110) and any BSF8 (e.g. 136) and
compare — the bytes that differ beyond code+serial are candidates for
model/firmware id.

## Then (once the bit is known)

- Read it via GET_SYS_VAL 0x83, set via SET_SYS_VAL 0x82 (both exist in the lib).
- Belongs in the SIAC air+ operation of the SportIdent-config menu phase
  (see 2026-06-01-sportident-config-menu.md, operation #4) — gated behind a
  confirm + read-back-verify, since writing config changes station behaviour.

## Provenance

Derive the bit from our own --dump capture, SPORTident's direct answer, or the
developer documentation SPORTident provides on request (PC Programmer's Guide;
cite it, don't redistribute it). Never from their .NET library binary: its
licence forbids deriving information from it. Note that SPORTident advises
against low-level station configuration and recommends Config+; any write
support needs read-back verification and must never be used untested at a
competition. See the parent config-menu todo.

## Capture record

Fill in one record per bench case. Raw captures with personal data (card
holder names, card numbers) stay out of git; commit only scrubbed fixtures.

- Case ID and date:
- Station model and firmware:
- Card type and firmware (where available):
- Mode (contact or AIR+) and station code (set through Config+):
- Serial transport (device, baud, direct or coupled):
- Punch history from a cleared card, including mode changes:
- Raw request/response bytes:
- What a reference readout shows, and its precision:
- Our commit and result:
- Conclusion and what is still unknown:

Read and keep ALL blocks of the card before and after each case, so any card-side data is found by diff.
