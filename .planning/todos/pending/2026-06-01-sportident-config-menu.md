---
created: 2026-06-01T11:00:00+02:00
title: SportIdent Config clone — station service menu (clear/reset, clock-sync, config clone)
area: sportident
files:
  - packages/sportident/src/SiStation/readBackup.ts
  - packages/sportident/src/SiStation/SiMainStation.ts
  - packages/sportident/src/SiStation/SiTargetMultiplexer.ts
  - packages/sportident/src/constants.ts
  - apps/edge/src/routes/checkunit.ts
  - apps/web/src/lib/screens/KvarISkovenView.svelte
  - .reference/pcprog5-v11-2018-10-15/pcprog5.pdf
---

## Idea (from Jonas, 2026-06-01 hardware session)

While testing kvar-i-skogen against a real BSF8, Jonas asked for a "SportIdent
Config clone" menu in fartOLa — a single screen to run the station service
operations an operator otherwise needs SPORTident Config+ (Windows) for. The
backup-read (kvar-i-skogen) already does the hard part (inductive coupling +
§2.5 retry + wake handling); these are the natural siblings that reuse the same
machinery.

This is its own phase — each operation needs the coupling/wake handling, a UI
surface, and (for destructive ops) a confirm + save-first guard.

## Operations to support

### 1. Hämta data och radera/reset ("read then clear")
- After a competition, read the check unit's backup AND erase it so it's clean
  for next time.
- Erase command: **ERASE_BDATA 0xF5** (pcprog §3.1: "Reset backup memory address
  pointer"). Request `STX 0xF5 0x00 CRC1 CRC0 ETX`; reply echoes `0xF5 0x02 CN1
  CN0 ...` or NAK.
- SAFETY: must read + persist the backup FIRST, confirm the read succeeded, then
  erase. Never erase on a failed/partial read. Add an explicit confirm dialog
  ("Detta raderar dosans minne — fortsätt?"). Consider storing the snapshot to
  the events/competition log before erasing so it's recoverable.

### 2. Klock-synk (clock sync) for all units
- Sync the clock on check / MÅL (finish) / numbered control units so punch times
  line up across the event.
- Command: **SET_TIME 0xF6** (pcprog §"Set/Get time"). Payload: `CD2 CD1 CD0
  (yy-mm-dd binary) TD TH TL TSS`. TD packs day-of-week + 12h half-day flag (bit
  0 = am/pm); TH:TL = 12h timer binary; TSS = sub-seconds (1/256). GET_TIME 0xF7
  reads it back to verify.
- NOTE the SI half-day / 12h clock model — reuse the existing SiTime helpers
  (date2arr / arr2date in siProtocol.ts) which already model this.
- Sync against the operator laptop's clock. Offer "sync this unit" and ideally
  "sync all coupled units in sequence" (dip each, sync, next).

### 3. Config clone / inspect
- Read a station's config blob (GET_SYS_VAL 0x83 over the full 0x00..0x80 range —
  already implemented as BaseSiStation.readInfo) and display mode/code/flags.
- "Clone": copy selected settings (code number, mode, beep/flash flags) from one
  reference unit to others. Uses SET_SYS_VAL 0x82 (writeDiff already exists in
  BaseSiStation). Lower priority than 1 & 2 — start read-only (inspect), add
  write/clone later.

## Shared infrastructure (already built — reuse)

- **Inductive coupling relay**: SET_MS 0x53 → forwarded commands → SET_MS 0x4D,
  with §2.5 NAK retry. Lives in readCoupledBackupMemory (readBackup.ts). Extract
  a generic `withCoupledStation(station, fn)` helper so clear/clock/config all
  share the relay + retry + restore-direct-on-throw + asleep detection.
- **Wake handling**: CoupledStationAsleepError + UI "dip a card to wake it"
  prompt already exist for the backup read — generalize for all ops.
- **Hardware-verified frame shape**: station.sendMessage() returns
  `[cmd, len, ...payload]`; see __fixtures__/coupled-backup-golden.md.

## Hardware findings (2026-06-01 bench, probe --info on coupled units)

Six units read and cross-checked against printed labels (110, 136, mål, töm,
start, check). Full byte dump: __fixtures__/station-info-captures.md.

VERIFIED:
- Config-memory reads (GET_SYS_VAL 0x00, 0x70) DO work over the inductive link
  once the station is awake — earlier all-NAK runs were SLEEP, not an address
  limitation. Must wake (card dip) first; the 0x1C liveness read NAKs forever
  if asleep.
- A 128-byte GET_SYS_VAL never syncs over coupling — read in small (≤8-byte)
  windows. (pcprog §3.1: as few bytes per cycle as possible.)
- STATION CODE (low byte) = config byte 0x72, also = reply header CN1 CN0.
  Confirmed on all 6 units.
- SERIAL number = uint32 BIG-ENDIAN at config 0x00..0x03. Decodes EXACTLY to the
  printed serial on all 6 units (e.g. 110→0x0008ff0a=589578, 136→0x0002d193=
  184723, töm→0x0001d509=120073). The trailing `ff 36 35 36` ("656") at
  0x04..0x07 is a CONSTANT on every unit — NOT part of the serial (that's what
  made it look ambiguous before).
- OPERATING MODE = config byte 0x71, LOW NIBBLE = SI mode enum:
  Control=2, Start=3, Finish=4, Clear=7, Check=10 (0x0A). Proven by the Swedish
  labels — töm→Clear(7), mål→Finish(4), start→Start(3), check→Check(10),
  numbered controls 110/136→Control(2). The two controls also carry 0x30 in the
  high nibble (flag bits; meaning TBD but irrelevant to mode identification —
  mask with & 0x0f).
- probe --info now decodes serial + mode for real (was printing raw windows
  only). MODE_NAMES lookup added.

UNRESOLVED:
- HIGH-NIBBLE FLAGS on byte 0x71 (0x30 on the two numbered controls, 0x00 on the
  function stations) — exact meaning unknown (autosend? extended protocol?
  beacon?). Doesn't block anything; mask it off for mode.
- MODEL / firmware (BSF8 vs BSF9): unit 110 is a BSF9, the other five BSF8 (start
  unknown). Their 0x70/0x00 windows are identical apart from code+serial, so the
  model/firmware id lives at an address not yet read. Capture more windows
  (e.g. 0x08..0x10) from a BSF8 vs BSF9 to locate it. Low priority.

## UI

- New nav menu item "Stämpeldosor" / "SportIdent" with sub-actions: Hämta &
  radera, Klock-synk, Inspektera/klona config.
- Each action: same wake instructions block already added to KvarISkovenView;
  destructive actions get a confirm.
- The probe script (packages/sportident/scripts/probe-coupled-backup.ts) is the
  bench tool for verifying each new command against real hardware before wiring
  the UI — extend it with --erase / --settime modes (read-only dump first).

## Open questions
- How long does a BSF8 stay awake after a card dip? (Affects "sync all in
  sequence" UX.) Measure on bench.
- Erase: confirm the exact 0xF5 reply framing on real hardware before trusting
  it (capture with the probe first — same approach that caught the backup-read
  bugs).
- Clock: does SET_TIME need the station awake/coupled the same way, or can the
  directly-attached USB master be time-set without coupling? (MÅL/numbered units
  are also coupled, so probably yes.)

## Why now / why deferred
Surfaced during the 2026-06-01 kvar-i-skogen hardware bring-up. The immediate
snapshot-wake fix shipped separately; this larger menu is deferred to its own
phase because each op needs hardware verification (probe capture) + destructive-
op guards + a real UI surface. See [[project-coupled-checkunit-readout]].
