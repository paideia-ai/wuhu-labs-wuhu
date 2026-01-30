#!/usr/bin/env bash
set -e

wuhu_dir="$PWD/wuhu-terragon"
git clone https://github.com/paideia-ai/wuhu "$wuhu_dir"
(cd "$wuhu_dir" && bash ./terragon-setup.sh)
