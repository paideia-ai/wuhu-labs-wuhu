#!/usr/bin/env bash
set -euo pipefail

# This script is intended to be runnable from any working directory.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TERRAGON_ROOT="${TERRAGON_ROOT:-$SCRIPT_DIR}"

WUHU_REPO_URL="${WUHU_REPO_URL:-https://github.com/paideia-ai/wuhu.git}"
WUHU_DIR="${WUHU_DIR:-/root/wuhu-terragon}"

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"

if [ -e "$WUHU_DIR" ] && [ ! -d "$WUHU_DIR" ]; then
  die "WUHU_DIR exists but is not a directory: $WUHU_DIR"
fi

if [ ! -d "$WUHU_DIR/.git" ]; then
  if [ -d "$WUHU_DIR" ] && [ -n "$(ls -A "$WUHU_DIR" 2>/dev/null || true)" ]; then
    die "WUHU_DIR is non-empty but not a git repo: $WUHU_DIR"
  fi

  log "Cloning wuhu into: $WUHU_DIR"
  git clone "$WUHU_REPO_URL" "$WUHU_DIR"
else
  log "Using existing wuhu checkout at: $WUHU_DIR"
  if [ "${WUHU_UPDATE:-0}" = "1" ]; then
    log "Updating wuhu checkout (WUHU_UPDATE=1)"
    git -C "$WUHU_DIR" fetch --all --prune
    git -C "$WUHU_DIR" pull --ff-only
  fi
fi

if [ ! -f "$WUHU_DIR/terragon-setup.sh" ]; then
  die "Expected setup script not found: $WUHU_DIR/terragon-setup.sh"
fi

log "Running: $WUHU_DIR/terragon-setup.sh"
chmod +x "$WUHU_DIR/terragon-setup.sh" 2>/dev/null || true
(cd "$WUHU_DIR" && ./terragon-setup.sh)

log "Done."
