#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; cd "$ROOT"
WUHU_DIR="${WUHU_DIR:-/root/wuhu-terragon}"
WUHU_REPO_URL="${WUHU_REPO_URL:-https://github.com/paideia-ai/wuhu.git}"
[ -d "$WUHU_DIR/.git" ] || git clone "$WUHU_REPO_URL" "$WUHU_DIR"
(cd "$WUHU_DIR" && bash ./terragon-setup.sh)
