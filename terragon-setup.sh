#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; cd "$ROOT"
WUHU_DIR="${WUHU_DIR:-/root/wuhu-terragon}"
[ -d "$WUHU_DIR/.git" ] || git clone https://github.com/paideia-ai/wuhu.git "$WUHU_DIR"
(cd "$WUHU_DIR" && bash ./terragon-setup.sh)
