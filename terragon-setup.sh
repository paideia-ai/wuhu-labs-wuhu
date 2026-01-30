#!/usr/bin/env bash

set -e

# Install Deno if not present
if ! command -v deno &> /dev/null; then
  curl -fsSL https://deno.land/install.sh | sh
  export PATH="$HOME/.deno/bin:$PATH"
fi

# go to the folder where this script lives
cd "$(dirname "$0")"
cd ..
git clone https://github.com/paideia-ai/wuhu.git wuhu-terragon
cd wuhu-terragon
./terragon-setup.sh

# Clone axiia-website for reference patterns
cd ..
git clone https://github.com/paideia-ai/axiia-website.git axiia-website
