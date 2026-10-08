# @fartola/sportident

NDJSON-emitting reader for SPORTident BSM7/8-USB readout stations on
Linux. Reads SI5, SI9, SI10 and SIAC Air+ cards and writes one JSON
object per line to stdout for downstream consumption.

This package is the hardware-bridge layer of fartOLa. It is MIT-licensed
(see `LICENSE`) so it can eventually be published as a standalone library
independent of fartOLa's AGPL application code. See `NOTICE.md` for
upstream attribution.

## Phase 0 scope

- **Cards:** SI5, SI9, SI10, SIAC Air+ via touch-readout
- **Stations:** BSM7-USB and BSM8-USB (CP210x USB-serial)
- **Platforms:** Linux only in Phase 0 (cross-platform in Phase 1)
- **Output:** NDJSON to stdout; diagnostics to stderr

## Run

After `pnpm install` at the repo root:

```sh
# from packages/sportident/
pnpm dev:readout          # runs src/bin/fartola-readout.ts via Node 22 type-stripping
pnpm exec fartola-readout  # runs the built dist/bin/fartola-readout.cjs (after pnpm build)
```

The reader opens the serial device given by `FARTOLA_DEVICE` (default
`/dev/ttyUSB0`). Set the variable to a different path if your reader
enumerates elsewhere.

## Running the hardware smoke

Plan 06 ships `scripts/hardware-smoke.sh` — an operator-driven smoke
that records 4 directional fixtures (SI5 / SI9 / SI10 / SIAC) and
asserts each card's NDJSON shape.

### Preflight

1. **`/dev/ttyUSB0`** — `ls -l /dev/ttyUSB0` shows `crw-rw---- root:dialout`
   with the CP210x kernel driver bound. Reseat the BSM7/8 cable if
   missing.
2. **`dialout` group** — `$USER` must be in `dialout`. If not:
   `sudo usermod -aG dialout $USER` and log out + in.
3. **Node 22.18+** — the bin relies on Node-native TS stripping
   (`node --version`).
4. **Build the dist bundle** — `pnpm --filter @fartola/sportident exec tsup`
   produces `dist/bin/fartola-readout.cjs`; the smoke spawns the built
   bundle, not the source.

### Linux gotchas

- **`brltty`** — Ubuntu ships `brltty` (Braille TTY driver) which races the
  CP210x driver for `/dev/ttyUSB0`. If `dmesg` shows brltty grabbing the
  device, `sudo apt-get remove brltty`. (RESEARCH §Landmines #1.)
- **`dialout`** — without group membership, `serialport.open` fails with
  `EACCES`. The smoke script preflights this and aborts before any
  recording. (RESEARCH §Landmines #2.)

### Run

```sh
./scripts/hardware-smoke.sh
```

The script prompts you to insert SI5, then SI9, then SI10, then SIAC in
turn. For each card it runs `pnpm exec fartola-readout --record
packages/sportident/tests/fixtures/jonas/<card>-jonas-001 --once`. The
bin exits after a single `card_read` event. The script then parses the
emitted NDJSON via `node -e` and asserts `card_type` matches the
expected label; it prints the decoded `card_number` so you can verify
against the printed label on the physical card.

Exit 0 = all 4 cards round-tripped + 8 fixture files (`<card>-jonas-001
.bytes.hex` and `<card>-jonas-001.expected.json` per card type) committed
under `packages/sportident/tests/fixtures/jonas/`.

### `--record` / `--replay` workflow

- `pnpm exec fartola-readout --record <basename> --once` — captures one
  card as `<basename>.expected.json` (NDJSON) AND `<basename>.bytes.hex`
  (directional wire transcript). `<basename>` resolves under either the
  current working directory or `/tmp`; any other path is rejected
  synchronously before the streams open (codex review #7).
- `<basename>.bytes.hex` is a **directional transcript**, NOT a raw byte
  dump: each non-comment line is either `out <hex>` (bytes the host sent
  to the station) or `in <hex>` (bytes the station sent back), in
  chronological order. The replay engine asserts the station-side send
  order matches when replaying (codex review #6).
- `pnpm exec fartola-readout --replay <basename>` — drives the SiMain
  Station pipeline against the recorded transcript via a deterministic
  playback transport and compares the produced NDJSON to
  `<basename>.expected.json` (with `ts_ms` normalised). Exits 0 on byte-
  equal match, 1 on diff.
- Plan 1 (and any later regression) can re-run replay over the committed
  fixtures to confirm no-hardware CI parity with the bench reads.

### Tag

After the smoke passes and the fixtures land:

```sh
git tag -s v0.0.1-handshake -m "Phase 0 hardware-proof complete"
git push origin v0.0.1-handshake
```

This closes Phase 0 success criterion #6 (tagged release).

## Operator helpers (one-off bench scripts)

- **`scripts/repair-station-sn.mjs`** — one-off operator helper that restores
  byte 0x02 of a BSM7/8 station's serial number to `0x0E`. It exists to undo
  the Plan 00-04 handshake bug (whole-byte CODE write to offset 0x02, fixed in
  Plan 00-06) on Jonas's bench reader, which corrupted his station's SN from
  593656 (`0x00090EF8`) to 593144 (`0x000909F8`) on 2026-05-13. Usage:

  ```sh
  node scripts/repair-station-sn.mjs [/dev/ttyUSB0]
  ```

  The script verifies the post-write SN bytes and exits non-zero if byte 0x02
  is not `0x0E` after the write. Delete the file once your reader is verified
  to report SN 593656 again — it has no other purpose.

## Attribution

This package contains code ported from
[allestuetsmerweh/sportident.js](https://github.com/allestuetsmerweh/sportident.js)
under MIT. See `NOTICE.md` for the full third-party software list.

## Trademark

SPORTident is a trademark of SPORTident GmbH. This package is an
independent project and is not affiliated with or endorsed by SPORTident.
