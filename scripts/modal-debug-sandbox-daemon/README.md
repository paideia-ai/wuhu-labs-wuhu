# Modal debug launcher (sandbox daemon + UI)

Runs `@wuhu/sandbox-daemon` in a Modal Sandbox and serves the static UI from the
same sandbox on a separate encrypted port.

## Prereqs

Environment variables:

- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- Optional: `GH_TOKEN` (or `GITHUB_TOKEN`)
- Optional: `OPENAI_API_KEY` (or `WUHU_DEV_OPENAI_API_KEY`)

## Run

From repo root:

```bash
cd scripts/modal-debug-sandbox-daemon
bun install
bun run start
```

## Options

- `WUHU_MODAL_JWT_ENABLED=true` to enable daemon JWT auth (prints `ADMIN_BEARER`
  - `USER_BEARER`)
