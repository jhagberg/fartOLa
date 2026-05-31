#!/usr/bin/env bash
# Authored for fartola. Not ported from upstream.
#
# scripts/run-local.sh — build the fartOLa stack and run it straight from
# dist/, with no `npm install -g` step (so it can never go stale / shadow an
# old global binary). The production bin serves BOTH the HTTP/WS API + SI
# bridge (edge) AND the bundled web UI (apps/web/build copied into
# dist/web) on a single port — there is nothing else to start.
#
# Usage:
#   bash scripts/run-local.sh                 # build + run; reader defaults to /dev/ttyUSB0
#   bash scripts/run-local.sh --no-build      # skip the rebuild, just run what's in dist/
#   bash scripts/run-local.sh --no-bridge     # run with NO SI reader (UI only)
#   bash scripts/run-local.sh --serial /dev/ttyUSB1        # different reader port
#   bash scripts/run-local.sh --serial /dev/ttyUSB0:left --serial /dev/ttyUSB1:right  # two readers
#
# Any flag this script doesn't recognise is passed straight through to the
# `fartola` bin (see `fartola --help`), so --competition-id, --retention-days,
# etc. all work.
#
# Env overrides (all optional):
#   PORT=3000           HTTP port
#   BIND_HOST=0.0.0.0   listen host (0.0.0.0 = reachable from other LAN computers)
#   DATA_DIR=~/.local/share/fartola     base dir for db + backups
#   DB_PATH / BACKUP_DIR                override individually
#   FARTOLA_DEV=1       dev admin endpoints on (default on here)
#
# Locked-style sibling of scripts/build-fartola.sh + scripts/dev.sh.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"

PORT="${PORT:-3000}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
DATA_DIR="${DATA_DIR:-$HOME/.local/share/fartola}"
DB_PATH="${DB_PATH:-$DATA_DIR/fartola.db}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"

SKIP_BUILD=0
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)
      SKIP_BUILD=1
      shift
      ;;
    -h | --help)
      sed -n '3,33p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

BIN="$REPO_ROOT/apps/edge/dist/bin/fartola.cjs"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "[run-local] building stack (pnpm build:fartola)…"
  pnpm build:fartola
fi

if [[ ! -f "$BIN" ]]; then
  echo "[run-local] FATAL: $BIN missing — run once without --no-build to build it." >&2
  exit 1
fi

mkdir -p "$DATA_DIR" "$BACKUP_DIR"

# Non-loopback bind needs the explicit --allow-lan guard the bin requires.
LAN_FLAG=()
case "$BIND_HOST" in
  127.* | ::1 | localhost) ;;
  *) LAN_FLAG=(--allow-lan) ;;
esac

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo "[run-local] starting fartola"
echo "  bin     : $BIN"
echo "  port    : $PORT    bind: $BIND_HOST ${LAN_FLAG[*]:-}"
echo "  db      : $DB_PATH"
echo "  backups : $BACKUP_DIR"
if [[ ${#PASSTHRU[@]} -gt 0 ]]; then
  echo "  extra   : ${PASSTHRU[*]}"
else
  echo "  reader  : (default /dev/ttyUSB0 — pass --no-bridge for UI-only)"
fi
echo "  open    : http://localhost:$PORT   (use this on THIS laptop — operator)"
if [[ -n "$LAN_IP" && ${#LAN_FLAG[@]} -gt 0 ]]; then
  echo "  LAN     : http://$LAN_IP:$PORT   (other computers — need an event code)"
fi
echo ""

exec env FARTOLA_DEV="${FARTOLA_DEV:-1}" node "$BIN" \
  --port "$PORT" \
  --bind-host "$BIND_HOST" \
  "${LAN_FLAG[@]}" \
  --db-path "$DB_PATH" \
  --backup-dir "$BACKUP_DIR" \
  "${PASSTHRU[@]}"
