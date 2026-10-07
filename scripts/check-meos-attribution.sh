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
HEADER='^[[:space:]]*(//|#|\*|/\*|<!--)[[:space:]]*Ported from MeOS code/'

ported_in() {
  [[ -d "$1" ]] || return 0
  find "$1" -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.svelte' \) \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.svelte-kit/*' \
    -print0 | sort -z | while IFS= read -r -d '' f; do
    if head -10 "$f" | grep -qE "$HEADER"; then echo "$f"; fi
  done
}

FAILED=0
for f in $(ported_in packages/sportident) $(ported_in packages/shared-types); do
  echo "MeOS-ported code in an MIT/shared package (ADR-0001): $f" >&2
  FAILED=1
done

COUNT=0
for f in $(ported_in apps); do
  COUNT=$((COUNT + 1))
  if ! grep -qF "\`$f\`" apps/edge/NOTICE.md 2>/dev/null; then
    echo "MeOS-ported file not listed in apps/edge/NOTICE.md: $f" >&2
    FAILED=1
  fi
done

[[ $FAILED -eq 0 ]] || exit 1
echo "MeOS attribution: OK ($COUNT ported files listed)"
