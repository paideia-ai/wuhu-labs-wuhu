# Stage 3.1: Sandbox Image + Smoke Test

Build and validate the sandbox image before integrating with Core.

## Sandbox Image

`core/Dockerfile.sandbox` builds an image with:
- Deno runtime
- Sandbox daemon code
- Pi agent (via npm/pnpm)
- Node.js (for Pi)
- Git, curl, unzip

Build locally:
```bash
docker build -f core/Dockerfile.sandbox -t wuhu-sandbox:latest ./core
```

## Smoke Test Script

`scripts/smoke-sandbox.ts` — standalone test that validates the sandbox daemon works end-to-end.

Inputs (env vars):
- `GITHUB_TOKEN` — for cloning private repos
- `OPENAI_API_KEY` — for Pi agent

What it does:
1. Runs sandbox container locally (docker run)
2. Waits for daemon to be ready (poll `/health`)
3. Sends `POST /credentials` with API keys
4. Sends `POST /init` with repo config (this repo: `wuhu-labs/wuhu`)
5. Sends `POST /prompt` with `"show me what's in pwd"`
6. Streams events until turn completes
7. Asserts: got a response mentioning files/directories
8. Sends `POST /shutdown`
9. Exits 0 on success, 1 on failure

Usage:
```bash
GITHUB_TOKEN=ghp_xxx OPENAI_API_KEY=sk-xxx deno run -A scripts/smoke-sandbox.ts
```

## GitHub CI

`.github/workflows/smoke-sandbox.yml`:

```yaml
name: Smoke Test Sandbox

on:
  workflow_dispatch:
  push:
    paths:
      - 'core/Dockerfile.sandbox'
      - 'core/packages/sandbox-daemon/**'

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Deno
        uses: denoland/setup-deno@v2

      - name: Build sandbox image
        run: docker build -f core/Dockerfile.sandbox -t wuhu-sandbox:latest ./core

      - name: Run smoke test
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: deno run -A scripts/smoke-sandbox.ts
```

Notes:
- Uses `secrets.GITHUB_TOKEN` (automatic, scoped to this repo)
- Uses `secrets.OPENAI_API_KEY` (add manually to repo secrets)
- Tests against this repo itself as the clone target

## Validates

- Sandbox image builds successfully
- Daemon starts and responds to health checks
- Credentials injection works
- Repo cloning works (with GitHub token)
- Pi agent runs and produces a response
- Full lifecycle: start → clone → prompt → respond → shutdown

## Deliverables

1. `core/Dockerfile.sandbox` — sandbox image (may already exist, verify it works)
2. `scripts/smoke-sandbox.ts` — smoke test script
3. `.github/workflows/smoke-sandbox.yml` — CI workflow
