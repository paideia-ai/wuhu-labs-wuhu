# Wuhu Architecture Vibe

## The Pivot

Wuhu is not Terragon. Terragon was "agents do your coding tasks". Wuhu is a data
layer + API for understanding coding agents.

Core value:

- Collect session logs from all agents (Claude Code, Codex, OpenCode, etc)
- Provide APIs for querying - agents use these to understand code context
- Git blame a line → find the session that wrote it → understand the why

No fancy dashboards. Just storage, APIs, and tools that smart agents consume.

## Philosophy

- Composition over integration - expose primitives, let agents compose
- Small interfaces, easy mocks - UI dev doesn't need real sandboxes
- Stories as specs - one artifact for tests, health checks, and UI previews
- GitHub-optional - mock locally, polling for no-domain setups
- Infrastructure-agnostic contracts - "I need a cache" not "I need Redis"

## Components

### Session Logs (see session-logs-component.md)

First component. Foundation of Wuhu.

### Controller

Service that sits between main app and sandboxes:

- Provides credentials to sandboxes (LLM tokens, GitHub PAT)
- Proxies LLM calls (sandbox never sees real tokens)
- Could proxy preview URLs
- Adapts to deployment mode (self-hosted runner vs hosted sandbox)

### Sandbox + Daemon

**Pivot: Self-hosted k3s** (Modal/3rd-party sandbox work on hold)

Reason: Jobs need direct access to internal services (MCP servers). Running in
our own k3s cluster avoids exposing internal services externally.

**Sandbox = K8s Job**

- Runs forever until manually killed via web UI (MVP)
- No auto-termination for now

**Job lifecycle:**

1. Job starts with setup script as entrypoint
2. Setup script downloads bundled daemon from internal cluster service
3. Setup script installs Pi agent
4. Setup script starts daemon in background
5. Setup script loops checking for sentinel file (`/tmp/shutdown`)
6. On shutdown: daemon receives kill signal → writes sentinel file → exits
7. Loop sees file → script exits → Job completes

```bash
#!/bin/sh
# download daemon from internal service
curl -o daemon http://internal-service/daemon
# install pi agent
...

# start daemon in background
./daemon &

# wait for exit signal
while [ ! -f /tmp/shutdown ]; do
  sleep 1
done
```

**Daemon:**

- Agent runtime inside the Job
- Configured with endpoints from Controller
- Doesn't know or care about deployment mode
- Has HTTP API for control (including shutdown)

### GitHub Abstraction

Split into verbs and observations:

Verbs (mutations):

- clone, checkout, commit, push
- create PR, update PR, merge PR

Observations (queries):

- branch status, diff, log
- PR state, checks status
- webhook events / poll for changes

Both Daemon and main app use this. Daemon needs verbs (including create PR).
Main app needs both.

Mockable for local dev. Polling vs webhooks are two implementations of
observation side.

## Main App Architecture

Event-driven + periodic catchup pattern:

- Triggers: events (webhook, user action) OR cron (catch missed events)
- Actions: stateless functions that evaluate state and act
- Idempotent - same logic runs regardless of trigger source

No long-running worker processes managing state. Just functions triggered by
events or time.

## Merge Queue Feature (Example)

MVP: squash-only, linear history. One strategy, no rebases.

Implementation:

- One action: "evaluate if we can move forward on merge queue"
- Triggered by: PR event OR periodic cron (every 10 min)
- Actions it can take:
  - Update branch to include new commits from main
  - Call merge into main
  - If conflict: abort queue, spawn agent to fix, ask user for review

The action is idempotent. Cron catches missed events. No complex state machine.

## Stage 1: Basic Sandbox Lifecycle (MVP)

No agent execution yet - validate sandbox lifecycle and routing.

**Domain:** `wuhu.liu.ms` (playground/prod)

**1. Web UI - Create Task**
- Select repo + enter initial prompt
- Creates a K8s Job (sandbox)
- Daemon starts but doesn't execute agent

**2. Sandbox Daemon**
- Starts a dummy static HTTP server on a random port
- No Pi agent execution yet

**3. Preview URL Routing (Traefik)**
- Expose sandbox ports via wildcard subdomain
- Pattern: `<sandbox-id>-<port>.wuhu.liu.ms`
- Uses existing `*.wuhu.liu.ms` DNS/cert (no infra changes)
- Traefik routes based on host prefix

**4. Web UI - Sandbox List**
- Show all active sandboxes
- Kill button → daemon shutdown → Job terminates

**Validates:**
- Job creation/termination
- Port exposure/routing
- UI flow

## Infrastructure Assumptions

- Data broker: Redis (or Redis-over-HTTP for serverless)
- RDBMS: Postgres (handles FTS, vectors, everything)
- Object storage: R2/S3-compatible
- Components never expose infra directly - contracts are abstract
