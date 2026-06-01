# Golden hardware capture — coupled BSF8 backup read

Captured 2026-06-01 from a real BSF8 check unit inductively coupled on a
BSM7-USB master, via `scripts/probe-coupled-backup.ts --raw`. Station had to be
woken with a card dip first. These bytes are the ground truth for the
readBackup parser rewrite (the original parser was written against a mock with
a fictional layout and never matched real hardware).

## GET_SYS_VAL backup pointer — request `[0x1C, 0x07]`

TX: `ff 02 83 02 1c 07 74 06 03`
RX: `02 83 0a 00 02 1c 00 00 18 04 ff 04 28 73 f3 03`

Parsed params (parse() → slice(3, 3+0x0a)):
`[00 02 1c 00 00 18 04 ff 04 28]`
= CN1=00 CN0=02 ADDR=1c | data(7) = `00 00 18 04 ff 04 28`

Spec §3.1: the 7 data bytes are `EP3 EP2 xx xx xx EP1 EP0`.
EP3=00 EP2=00 xx=18 xx=04 xx=ff EP1=04 EP0=28
=> backup pointer = 0x00000428 = 1064 (ABSOLUTE next-free address; data lives
from 0x100 up to 0x428).

## GET_BACKUP first block — request `[0x00, 0x01, 0x00, 0x80]` (addr 0x000100, len 128)

TX: `ff 02 81 04 00 01 00 80 fa 7f 03`
RX (3 chunks, reassembled):
`02 81 85 00 02 00 01 00 15 cd 56 69 69 54 37 54 15 cd 62 69 69 54 46 09 15 cd 68 69 69 54 4b a2 7b 9a 16 69 69 55 47 12 02 f7 67 69 69 56 21 0a 16 fb c0 69 69 56 2a c0 7b 9a 16 69 69 56 99 fa 02 f7 61 69 69 56 b9 b3 15 cd 5f 69 69 57 11 66 81 de 02 69 69 57 7e fd 7b 6a 67 69 69 57 89 ad 7b 9a 16 69 69 57 8c e1 0c f9 95 69 69 57 96 58 20 57 a7 69 69 57 dc ee 20 57 9e 69 69 57 e1 2b 20 57 97 69 69 57 e4 c2 da 67 03`

command=0x81, numParameters=0x85=133.
params = 5-byte header `00 02 00 01 00` (CN1 CN0 ADR2 ADR1 ADR0) + 128 data bytes.

## Record layout (empirically confirmed)

8-byte records, oldest first. Each record:
bytes 0..2 : SI card number, big-endian (3 bytes)
bytes 3..4 : fixed `69 69` marker
bytes 5..7 : punch time (monotonic increasing across records → confirms align)

16 records in this block (card = bytes 0..2 BE):
1 15 cd 56 = 1428822
2 15 cd 62 = 1428834
3 15 cd 68 = 1428840
4 7b 9a 16 = 8100374 <-- REGISTERED competitor (appears 3x: r4, r7, r12)
5 02 f7 67 = 194407
6 16 fb c0 = 1506240
7 7b 9a 16 = 8100374 <-- REGISTERED
8 02 f7 61 = 194401
9 15 cd 5f = 1428831
10 81 de 02 = 8511490
11 7b 6a 67 = 8088167
12 7b 9a 16 = 8100374 <-- REGISTERED
13 0c f9 95 = 850837
14 20 57 a7 = 2119591
15 20 57 9e = 2119582
16 20 57 97 = 2119575

Cross-check: 8100374 is in the 4-klubbs competitor table and punched the start
check 3×. The first-3-bytes-BE decode is correct for this event's cards (all
≤ 0x98967F = 9999999, fit in 3 bytes). NOTE: this `69 69`-marker layout may be
station-config-specific; revisit if a future event uses SIAC/8-digit cards that
exceed 3 bytes.

## Bugs in the ORIGINAL readBackup.ts this capture exposes

1. Pointer request sent `[0x00,0x00,0x80]` (3 params) → firmware read NUM=0 →
   returned no data → pointer parsed as 0 → "empty backup, no error". This was
   the user-visible "nothing happens". CORRECT: `[0x1C, 0x07]`.
2. GET_SYS_VAL response indexed at absolute offset 0x1C into the params array,
   but the real reply is just `CN1 CN0 ADDR + 7 data bytes` — the pointer is in
   the 7 data bytes, not at array index 0x1C.
3. GET_BACKUP response has a 5-byte header (`CN1 CN0 ADR2 ADR1 ADR0`) before the
   128 data bytes; parseBackupBlock parsed from byte 0 → ate the header.
4. Record card number read at offset BC_CN=3 (4 bytes) — real layout is bytes
   0..2. The mock encoded the fictional offset-3 layout, so tests passed.
5. Block loop started at address 0x00 (station config), not 0x100, and treated
   the pointer as a byte-count-from-0 rather than an absolute end address.
