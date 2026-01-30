#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; cd "$ROOT"
[ -d "${WUHU_DIR:-/root/wuhu-terragon}/.git" ] || git clone "${WUHU_REPO_URL:-https://github.com/paideia-ai/wuhu.git}" "${WUHU_DIR:-/root/wuhu-terragon}"
(cd "${WUHU_DIR:-/root/wuhu-terragon}" && bash ./terragon-setup.sh)
