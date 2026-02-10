# AGENTS.md

## What is Wuhu

Wuhu is a data layer + API for understanding coding agents. Not a task runner -
a session log collector and query system.

Core value: collect logs from Claude Code, Codex, OpenCode, etc. Provide APIs so
agents can query them. Git blame a line → find the session → understand the why.

Quick primer: `docs/what-is-a-coding-agent.md`.

## Status

This repo is the Swift pivot of Wuhu. It’s currently a Swift Package with:

- `PiAI`: a unified LLM client library (ported from `pi-mono`’s `pi-ai`)
- `wuhu`: a small CLI that demonstrates `PiAI` providers

## Project Structure

```
.
├── Package.swift
├── Sources/
│   ├── PiAI/                # Unified LLM API (OpenAI, OpenAI Codex, Anthropic)
│   └── wuhu/                # CLI binary demonstrating PiAI usage
├── Tests/
│   └── PiAITests/           # Provider + SSE parsing tests (swift-testing)
├── docs/
│   └── what-is-a-coding-agent.md
└── .github/workflows/
    └── ci.yml               # SwiftFormat + build + tests
```

## Local Dev

Prereqs:

- Swift 6.2 toolchain

Common commands (repo root):

```bash
swift test
swift run wuhu --help
swift run wuhu openai "Say hello"
swift run wuhu anthropic "Say hello"
```

Formatting:

```bash
swift package --allow-writing-to-package-directory swiftformat
swift package --allow-writing-to-package-directory swiftformat --lint .
```

Environment variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

If keys aren’t set in the environment, the `wuhu` CLI also tries to load a local `.env`.

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

General documentation lives in `docs/`.
