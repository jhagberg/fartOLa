#!/usr/bin/env bash
# Authored for fartola. Not ported from upstream.
#
# Build the publishable `fartola` tarball: chains `pnpm build` on
# @fartola/sportident (tsup → packages/sportident/dist/, which the other two
# import and the edge bundles), @fartola/web (SvelteKit adapter-static →
# apps/web/build/) and @fartola/edge (tsup → apps/edge/dist/), copies the web build + the IOF.xsd into the edge dist/
# tree, then `pnpm pack`s the edge package. The resulting tarball is
# self-contained: `npm install -g <tarball>` lands the `fartola` bin on PATH
# with no separate publish step for the workspace siblings (tsup noExternals
# @fartola/sportident + @fartola/shared-types into the bundle; see
# apps/edge/tsup.config.ts plan-18 comment).
#
# Plan-locked by:
# - .planning/phases/01-single-laptop-training-mvp/01-18-PLAN.md task 1
#   (interfaces block: build-fartola.sh + tarball layout)
# - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md §S-1
#
# Exits non-zero on any step failure; tail-2 output names the failing step.

set -euo pipefail

# Resolve repo root from this script's location (apps/edge/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$EDGE_DIR/../.." && pwd)"

DIST_DIR="$ROOT/dist"

# Always rebuilt: the edge bundles packages/sportident/dist, and a dist left
# from an earlier checkout would put old SPORTident code in the tarball.
echo "[1/6] Building packages/sportident (tsup)..."
pnpm --filter @fartola/sportident build

echo "[2/6] Building apps/web (SvelteKit adapter-static)..."
pnpm --filter @fartola/web build

echo "[3/6] Building apps/edge (tsup esm+cjs+dts)..."
pnpm --filter @fartola/edge build

echo "[4/6] Copying apps/web/build → apps/edge/dist/web..."
rm -rf "$EDGE_DIR/dist/web"
cp -r "$ROOT/apps/web/build" "$EDGE_DIR/dist/web"

echo "[5/6] Verifying packaged assets..."
# IOF.xsd is copied by the edge build script already; double-check it landed
# (the install-smoke test asserts the migrator + xsd validator both work
# off the tarball without source-tree fallbacks).
test -f "$EDGE_DIR/dist/xml/IOF.xsd" || {
  echo "FAIL: dist/xml/IOF.xsd missing — edge build did not copy the XSD"
  exit 1
}
test -d "$EDGE_DIR/dist/web/_app" || {
  echo "FAIL: dist/web/_app missing — SvelteKit adapter-static build incomplete"
  exit 1
}
test -f "$EDGE_DIR/dist/web/200.html" || {
  echo "FAIL: dist/web/200.html missing — SPA fallback target absent"
  exit 1
}
test -f "$EDGE_DIR/dist/bin/fartola.cjs" || {
  echo "FAIL: dist/bin/fartola.cjs missing — tsup did not emit the CJS bin"
  exit 1
}
test -d "$EDGE_DIR/drizzle" || {
  echo "FAIL: drizzle/ missing — migrations directory must ship in the tarball"
  exit 1
}

echo "[6/6] Packing tarball into $DIST_DIR/ ..."
mkdir -p "$DIST_DIR"
# pnpm pack writes to the package directory by default; --pack-destination
# routes the .tgz to the repo-root dist/.
cd "$EDGE_DIR"
pnpm pack --pack-destination "$DIST_DIR"

# pnpm pack names the file `<scope>-<name>-<version>.tgz` for scoped packages,
# i.e. `fartola-edge-0.1.0.tgz` for @fartola/edge. Re-alias as `fartola-<version>.tgz`
# so the install-smoke + README references stay stable.
SOURCE_TGZ="$(ls "$DIST_DIR"/fartola-edge-*.tgz 2>/dev/null | sort | tail -n1 || true)"
if [ -z "$SOURCE_TGZ" ]; then
  SOURCE_TGZ="$(ls "$DIST_DIR"/*.tgz 2>/dev/null | sort | tail -n1 || true)"
fi
if [ -z "$SOURCE_TGZ" ] || [ ! -f "$SOURCE_TGZ" ]; then
  echo "FAIL: no .tgz produced under $DIST_DIR"
  exit 1
fi

VERSION="$(node -p "require('$EDGE_DIR/package.json').version")"
ALIAS_TGZ="$DIST_DIR/fartola-${VERSION}.tgz"
if [ "$SOURCE_TGZ" != "$ALIAS_TGZ" ]; then
  cp -f "$SOURCE_TGZ" "$ALIAS_TGZ"
fi

echo "Done. Tarball at: $ALIAS_TGZ"
ls -lh "$ALIAS_TGZ"
