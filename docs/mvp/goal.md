# Wuhu MVP Goal

Wuhu is a data layer + API for understanding coding agents.

## Core Value

- Collect session logs from all agents (Claude Code, Codex, OpenCode, etc)
- Provide APIs for querying - agents use these to understand code context
- Git blame a line → find the session that wrote it → understand the why

No fancy dashboards. Just storage, APIs, and tools that smart agents consume.

## MVP Scope

5 stages that build toward a complete loop:

1. **Stage 1: Basic Sandbox Lifecycle** - Jobs, routing, kill
2. **Stage 2: Repo Cloning + File Server** - PAT, repos, clone
3. **Stage 3: Pi Agent Execution** - Persistent sessions, chat UI
4. **Stage 4: State Persistence** - DB + S3, SSE resume
5. **Stage 5: Session Query** - FTS, CLI for agents

After Stage 5: agents can work, sessions are stored, future agents can query past sessions. The core value prop is functional.

## Domain

- `wuhu.liu.ms` - playground/prod
- `*.wuhu.liu.ms` - wildcard for preview URLs
