# AGENTS.md

## What is Wuhu

Wuhu is a data layer + API for understanding coding agents. Not a task runner -
a session log collector and query system.

Core value: collect logs from Claude Code, Codex, OpenCode, etc. Provide APIs so
agents can query them. Git blame a line → find the session → understand the why.

See `notes/architecture-vibe.md` for full architecture discussion.

## Deployed URLs

- **Web UI**: https://wuhu.liu.ms
- **API**: https://api.wuhu.liu.ms

## Folder Instruction Files

Whenever you need to work in a folder that has an `AGENTS.md`, read that file
first. Also read `AGENTS.local.md` in that folder when present.

## Development Environment

You're running in a self-hosted Terragon instance. The original Terragon product
is dead - no commercial future, no data retrieval from the old hosted version.

## Docker

Build images locally:

```bash
docker build -t wuhu-core:test ./core
docker build -t wuhu-web:test ./web
```

Run locally (needs postgres):

```bash
docker run --rm -e DATABASE_URL="postgresql://user@host.docker.internal/wuhu_dev" \
  -p 3000:3000 wuhu-core:test
```

The core Dockerfile uses a multi-stage build:
1. **Node stage**: dependency/install preparation (Node 24)
2. **Build stage**: Deno install + typecheck
3. **Production stage**: Deno runtime only (no Node)

## Deployment

Deployed to a self-hosted k3s cluster via GitHub Actions (`.github/workflows/deploy.yml`).

**Trigger**: Push to `main` or manual `workflow_dispatch`

**Flow**:
1. Build Docker image with commit SHA tag
2. Import to k3s containerd
3. Apply k8s manifests from `deploy/`
4. Rolling update deployment

**Monitor**:

```bash
kubectl get pods
kubectl get deployments
kubectl logs -l app=core
kubectl describe pod -l app=core
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`.

**Steps**:
1. Setup Deno + Node 24
2. Lint, typecheck, test for both `core/` and `web/`

The CI uses a postgres service container - no external database needed.

## Reference Paths

These paths are available in the Terragon dev environment:

- `.` - Wuhu repo (this repo)
- `../wuhu-terragon` - Terragon source code, always available
- `../axiia-website` - Personal project with useful code patterns (Bun-based)
- `../codex` - OpenAI Codex repo, for integration experiments
- `../pi-mono` - Pi coding agent monorepo, reference harness

The `terragon-setup.sh` script clones these repos before your environment starts.

## Using Terragon Code

Terragon has working implementations of:

- Sandbox providers (E2B, Docker, Daytona)
- Daemon (agent runtime)
- GitHub integration (PRs, checkpoints, webhooks)
- Real-time updates (PartyKit)
- Web UI patterns

Reference it freely. Copy and adapt what makes sense. But Wuhu has different
goals - don't inherit Terragon's tight coupling.

## Key Differences from Terragon

Terragon: "agents do your coding tasks" - full product, tightly integrated Wuhu:
"understand your coding agents" - data layer, composition-first, modular

Wuhu principles:

- Expose primitives via API/MCP, let agents compose
- Small interfaces, easy mocks
- GitHub-optional (mock locally, polling for no-domain setups)
- Infrastructure-agnostic contracts

## Reference Projects

### Axiia Website (`../axiia-website`)

Personal project (paideia-ai/axiia-website). Bun monorepo with Elysia server,
React Router SSR, service registry pattern, and domain API layering. Useful
patterns for API design, DI, and config management. See `notes/axiia-website.md`
for details.

## Notes

Architecture discussions live in `notes/`:

- `architecture-vibe.md` - overall system design
- `session-logs-component.md` - first component spec
- `axiia-website.md` - reference project notes
