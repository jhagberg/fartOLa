#!/usr/bin/env bash
# Authored for fartola. Not ported from upstream.
#
# ADR-0001 (2026-10-06): code ported from MeOS (GPL-3.0-or-later) may live
# only in the AGPL parts (apps/edge, apps/web). Fails when
#   - a "Ported from MeOS" header sits in a file under packages/sportident/
#     or packages/shared-types/ (both MIT-licensed or published apart), or
#   - a file under apps/ with that header is not listed in apps/edge/NOTICE.md.
# A header is the phrase in a comment line within a file's first 10 lines.
# Usage: bash scripts/check-meos-attribution.sh [repo-root]   (part of `pnpm lint`)
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"
HEADER='^[[:space:]]*(//|#|\*|/\*|<!--)[[:space:]]*Ported from MeOS'

# Prints, NUL-separated, every source file under $1 whose first 10 lines carry
# the header. No pipe into grep -q (SIGPIPE under pipefail would skip a file),
# and NUL separation keeps file names with spaces whole.
ported_in() {
  [[ -d "$1" ]] || return 0
  local f top
  while IFS= read -r -d '' f; do
    top=$(head -n 10 "$f" || true)
    if grep -qE "$HEADER" <<<"$top"; then printf '%s\0' "$f"; fi
  done < <(find "$1" -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.svelte' \) \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.svelte-kit/*' \
    -print0 | sort -z)
}

FAILED=0
# Everything under packages/ is MIT or published apart: no ported code at all.
while IFS= read -r -d '' f; do
  echo "MeOS-ported code in an MIT/shared package (ADR-0001): $f" >&2
  FAILED=1
done < <(ported_in packages)

COUNT=0
while IFS= read -r -d '' f; do
  COUNT=$((COUNT + 1))
  if ! grep -qF "\`$f\`" apps/edge/NOTICE.md 2>/dev/null; then
    echo "MeOS-ported file not listed in apps/edge/NOTICE.md: $f" >&2
    FAILED=1
  fi
done < <(ported_in apps)

[[ $FAILED -eq 0 ]] || exit 1
echo "MeOS attribution: OK ($COUNT ported files listed)"
