#!/usr/bin/env bash
# Codex review #13 (and per-file D-11): enforce that every PORTED .ts file
# under packages/sportident/src/** and packages/sportident/tests/fixtures/upstream/**
# carries the required MIT NOTICE header ('Ported from allestuetsmerweh/sportident.js').
#
# Files authored for fartola (no upstream content) are allowlisted at the top of
# the script. This script is wired into the root `pnpm lint` chain so CI catches
# missing headers on any future ported file.
set -euo pipefail

ALLOWLIST=(
  # Transport — no upstream content (replaces WebUSB transport with serialport)
  "packages/sportident/src/transport/SerialTransport.ts"
  "packages/sportident/src/transport/ISerialTransport.ts"
  "packages/sportident/src/transport/errors.ts"
  "packages/sportident/src/transport/SerialTransport.test.ts"
  # Output layer — authored for fartola
  "packages/sportident/src/output/ndjson.ts"
  "packages/sportident/src/output/diagnostics.ts"
  "packages/sportident/src/output/ndjson.test.ts"
  "packages/sportident/src/output/diagnostics.test.ts"
  # Bin — authored for fartola
  "packages/sportident/src/bin/fartola-readout.ts"
  "packages/sportident/src/bin/record.ts"
  "packages/sportident/src/bin/replay.ts"
  "packages/sportident/src/bin/record.test.ts"
  "packages/sportident/src/bin/replay.test.ts"
  "packages/sportident/src/bin/replay-jonas-fixtures.test.ts"
  "packages/sportident/src/bin/parseArgs.test.ts"
  "packages/sportident/src/bin/fartola-trainer.ts"
  "packages/sportident/src/bin/fartola-trainer.test.ts"
  # Events util — replacement (no upstream code), wraps node:events
  "packages/sportident/src/utils/events.ts"
  # Integration tests authored for fartola
  "packages/sportident/src/integration/e2e.test.ts"
  "packages/sportident/src/integration/frameError.test.ts"
  "packages/sportident/src/integration/wireFormat.test.ts"
  "packages/sportident/src/integration/benchReplay.test.ts"
  "packages/sportident/src/integration/esmImport.test.ts"
  # Card-type inference helper — authored for fartola (no upstream content)
  "packages/sportident/src/SiCard/cardTypeFromNumber.ts"
  # Card-decoder tests authored for fartola (the decoders are ported, the tests are ours)
  "packages/sportident/src/SiCard/types/SiCard5.test.ts"
  "packages/sportident/src/SiCard/types/SiCard9.test.ts"
  "packages/sportident/src/SiCard/types/SiCard10.test.ts"
  "packages/sportident/src/SiCard/types/SIAC.test.ts"
  # Station tests authored for fartola against a FakeSerialTransport
  "packages/sportident/src/SiStation/SiMainStation.test.ts"
  "packages/sportident/src/SiStation/SiTargetMultiplexer.test.ts"
  # Storage barrel — no upstream code, just re-exports
  "packages/sportident/src/storage/index.ts"
  # Public API barrel — authored for fartola
  "packages/sportident/src/index.ts"
)

is_allowlisted() {
  local file="$1"
  for a in "${ALLOWLIST[@]}"; do
    [[ "$file" == "$a" ]] && return 0
  done
  return 1
}

MISSING=()
SCANNED=0
while IFS= read -r f; do
  SCANNED=$((SCANNED + 1))
  if is_allowlisted "$f"; then
    continue
  fi
  # Accept any of: "Ported from", "Ported (qualifier) from", "Derived from",
  # "Test data from" — every form anchors on `from allestuetsmerweh/sportident.js`
  # which is the canonical upstream URL. A file that declares itself
  # "Authored for fartola" carries no upstream content and needs no notice.
  if ! head -10 "$f" | grep -qE '(Ported|Derived|Test data)( \([^)]+\))? from allestuetsmerweh/sportident\.js|^// Authored for fartola'; then
    MISSING+=("$f")
  fi
done < <(find packages/sportident/src packages/sportident/tests/fixtures/upstream -type f -name '*.ts' 2>/dev/null | sort)

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "MIT attribution missing in ${#MISSING[@]} file(s):" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  exit 1
fi

echo "MIT attribution: OK ($SCANNED files scanned)"
exit 0
