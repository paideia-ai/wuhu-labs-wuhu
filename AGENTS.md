For any AGENTS.md and AGENTS.local.md:

- No Markdown header, only paragraph and lists.
- Concise over grammar
- When working in a folder with AGETNS.md or AGENTS.local.md, read it before any work.

---

Wuhu is a data layer + API for understanding coding agents. It is not a task runner; it is a session log collector and query system.
Core value: collect logs from Claude Code, Codex, OpenCode, etc. Provide APIs so agents can query them. Git blame a line, find the session, understand the why.
Full architecture discussion: `docs/architecture-vibe.md`.

- Deployed URLs:
- Web UI: `https://wuhu.liu.ms`
- API: `https://api.wuhu.liu.ms`

- Development environment:
- Self-hosted Terragon instance.
- Original Terragon product is dead; no commercial future and no hosted data retrieval.

- Docker local:
- Build core image: `docker build -t wuhu-core:test ./core`
- Build web image: `docker build -t wuhu-web:test ./web`
- Run core locally (needs postgres): `docker run --rm -e DATABASE_URL="postgresql://user@host.docker.internal/wuhu_dev" -p 3000:3000 wuhu-core:test`
- Core Dockerfile multi-stage:
- Node stage: dependency/install preparation (Node 24).
- Build stage: Deno install + typecheck.
- Production stage: Deno runtime only (no Node).

- Deployment:
- Deploy via GitHub Actions workflow `.github/workflows/deploy.yml`.
- Trigger: push to `main` or manual `workflow_dispatch`.
- Flow:
- Build Docker image with commit SHA tag.
- Import to k3s containerd.
- Apply manifests from `deploy/`.
- Rolling update deployment.
- Monitor:
- `kubectl get pods`
- `kubectl get deployments`
- `kubectl logs -l app=core`
- `kubectl describe pod -l app=core`

- CI:
- Workflow: `.github/workflows/ci.yml` on PRs and pushes to `main`.
- Steps:
- Setup Deno + Node 24.
- Lint, typecheck, test for `core/` and `web/`.
- Uses a postgres service container; no external database needed.

- Reference paths:
- `.`: this repo.
- `../wuhu-terragon`: Terragon source code.
- `../axiia-website`: personal project with useful patterns (Bun-based).
- `../codex`: OpenAI Codex repo for integration experiments.
- `../pi-mono`: Pi coding agent monorepo reference harness.
- `terragon-setup.sh` clones these repos before environment startup.

- Using Terragon code:
- Working implementations include sandbox providers (E2B, Docker, Daytona), daemon runtime, GitHub integration (PRs/checkpoints/webhooks), real-time updates (PartyKit), and web UI patterns.
- Copy/adapt what makes sense, but do not inherit Terragon's tight coupling.

- Difference from Terragon:
- Terragon: agents do coding tasks, tightly integrated product.
- Wuhu: understand coding agents, composition-first modular data layer.
- Principles:
- Expose primitives via API/MCP so agents compose.
- Small interfaces and easy mocks.
- GitHub-optional design (mock locally, polling for no-domain setups).
- Infrastructure-agnostic contracts.

- Reference project:
- Axiia Website `../axiia-website`: Bun monorepo with Elysia server, React Router SSR, service registry pattern, domain API layering.
- Useful for API design, DI, config management.
- See `docs/axiia-website.md`.

- Docs:
- `docs/architecture-vibe.md`: overall system design.
- `docs/session-logs-component.md`: first component spec.
- `docs/axiia-website.md`: reference project notes.
