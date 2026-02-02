# Runbook: Run `@wuhu/sandbox-daemon` inside a Modal Sandbox

Date: 2026-02-02

Goal: Build a Modal image (no Dockerfile) based on a public Node.js image,
install Pi Coding Agent first, install Deno and ensure it’s on `PATH`,
upload/bundle the `@wuhu/sandbox-daemon`, start it behind an **encrypted HTTPS
tunnel**, serve the standalone UI on a **separate port**, and talk to it using
**our JWT** (not Modal connect tokens).

## Prereqs (local env)

Environment variables:

- `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` (Modal auth)
- `GH_TOKEN` (GitHub token) **or** `GITHUB_TOKEN` (optional; used for
  `/credentials`)
- `OPENAI_API_KEY` **or** `WUHU_DEV_OPENAI_API_KEY` (optional; used for
  `/credentials` and Pi)

Security note: **Never commit or paste token values into the repo.** This doc
includes _how_ to pass tokens, not their values.

## 1) Bundle the daemon (Deno)

From repo root:

```bash
deno --version

rm -f /tmp/sandbox-daemon.bundle.js
deno bundle --platform=deno \
  -o /tmp/sandbox-daemon.bundle.js \
  packages/sandbox-daemon/main.ts
```

Notes:

- `deno bundle` behavior is evolving (Deno 2.x). This worked with Deno `2.6.7`.
- The output is a single JS file with dependencies inlined, ready to `deno run`.

## 2) Create a Modal image via “dockerfile commands” (no Docker)

Modal’s TS SDK supports image layers via `Image.dockerfileCommands([...])`, then
building via `image.build(app)`.

We used a base public Node image:

- `node:22-bookworm-slim`

Then installed:

1. Pi Coding Agent (first, as requested):

```bash
npm install -g @mariozechner/pi-coding-agent@0.51.0
```

2. Deno (and ensured it’s on PATH):

```bash
curl -fsSL https://deno.land/install.sh | sh -s v2.6.7
export PATH=/root/.deno/bin:$PATH
```

Also installed `git` (needed for `/init` cloning) and a few basics.

## 3) Start a sandbox (1 hour auto-delete)

When creating the sandbox, set BOTH:

- `timeoutMs: 60 * 60 * 1000`
- `idleTimeoutMs: 60 * 60 * 1000`

This overrides Modal’s default short lifetime (5 minutes).

Expose both daemon + UI ports via encrypted tunnels:

- `encryptedPorts: [8787, 4173]` (or your chosen UI port)

## 4) Upload the bundled daemon into the sandbox

Use Modal sandbox filesystem API:

- `sb.open(path, "w")` then `write()` the bundle bytes

We uploaded to:

- `/root/wuhu-daemon/sandbox-daemon.bundle.js`

## 5) Start the daemon inside the sandbox (Deno)

Run:

```bash
deno run -A /root/wuhu-daemon/sandbox-daemon.bundle.js
```

Environment used:

- `SANDBOX_DAEMON_HOST=0.0.0.0`
- `SANDBOX_DAEMON_PORT=8787`
- `SANDBOX_DAEMON_WORKSPACE_ROOT=/root/workspace`
- `SANDBOX_DAEMON_JWT_ENABLED=true`
- `SANDBOX_DAEMON_JWT_SECRET=<random secret>`
- Optionally `OPENAI_API_KEY=<...>` (if you have it; daemon reads from env)

Pi usage notes:

- The daemon defaults to `SANDBOX_DAEMON_AGENT_MODE=pi-rpc` and expects `pi` on
  `PATH`.
- Installing Pi globally (`npm install -g ...`) makes `pi` available.

## 6) Get the tunnel URL and talk to the daemon (JWT, not Modal connect token)

Fetch tunnels:

- `const tunnels = await sb.tunnels()` then `tunnels[8787].url`

Use _our_ JWT:

- `admin` scope can call everything
- `user` scope can call `/prompt`, `/abort`, `/stream`

CORS allowlist is configured at handshake time via `/init`:

```json
{
  "cors": {
    "allowedOrigins": ["https://your-ui.example"]
  }
}
```

Example curl (SSE):

```bash
curl -N \
  -H "Authorization: Bearer <USER_TOKEN>" \
  "https://<modal-host>/stream?cursor=0&follow=1"
```

Example curl (prompt):

```bash
curl -s -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"message":"hello from outside the sandbox"}' \
  "https://<modal-host>/prompt"
```

## 7) Passing the GitHub token (without exposing it)

We did **not** bake the GitHub token into the image.

Instead, we used `/credentials` and passed it as:

```json
{
  "version": "experiment",
  "github": { "token": "<GH_TOKEN>" }
}
```

Practical approach:

- Keep `GH_TOKEN` (or `GITHUB_TOKEN`) only in your local environment.
- In your launcher script, read it from env and send it to the daemon via
  `POST /credentials`.
- The daemon converts it to env vars for Pi and git tooling (sets `GITHUB_TOKEN`
  inside the spawned Pi process).

## Repro script (Deno + Modal SDK)

Run the launcher in `packages/tasks` (Deno-first, no Node):

```bash
deno run -A packages/tasks/modal-sandbox-daemon-launcher.ts
```

It builds the daemon bundle, builds the UI, creates the sandbox, uploads both,
starts the daemon + UI server, and calls `/init` with the UI origin in the CORS
allowlist. The script prints:

- Daemon URL
- UI URL
- `ADMIN_BEARER` + `USER_BEARER` tokens when JWT is enabled

## Repro script (Bun + Modal SDK)

If the Deno + Modal JS SDK path hangs (gRPC in Deno), use the Bun launcher:

```bash
bun run packages/tasks/modal-sandbox-daemon-launcher.bun.ts
```

## Troubleshooting

- If you get no agent events: ensure `pi` is installed and on `PATH`, and that
  the daemon is in `pi-rpc` mode (default).
- If cloning fails in `/init`: ensure `git` is installed and (if private repos)
  that you set `github.token` via `/credentials`.
- If SSE returns 401/403: use the correct JWT token/scope; `/stream` needs
  `user` (or `admin`), while admin endpoints need `admin`.
