# Stage 3: Agent Execution

Split into sub-stages for cleaner implementation.

## Stage 3.1: Sandbox Image + Smoke Test

See [stage-3.1-sandbox-image.md](./stage-3.1-sandbox-image.md)

Build and validate the sandbox image in isolation:
- Dockerfile.sandbox builds image with Deno, daemon, Pi, Node
- Smoke test script runs container, sends prompt, verifies response
- GitHub CI workflow for automated validation

Deliverables: Working sandbox image, smoke test script, CI workflow.

## Stage 3.2: Core API

See [stage-3.2-core-api.md](./stage-3.2-core-api.md)

Core becomes the sole interface for sandbox operations:
- Extended POST /sandboxes with prompt
- POST /sandboxes/:id/prompt
- POST /sandboxes/:id/abort
- GET /sandboxes/:id/stream/control (daemon lifecycle)
- GET /sandboxes/:id/stream/coding (agent events)

Deliverable: CLI script that can run a full coding session via Core API.

## Stage 3.3: Web UI

See [stage-3.3-web-ui.md](./stage-3.3-web-ui.md)

Wire web UI to Core API:
- Task creation with prompt
- Chat UI with SSE from Core
- Modular code structure
- Restore tests from old sandbox-daemon-ui

## Key Principle

**Web never talks to daemon directly.** All sandbox communication goes through Core.

```
Browser → Web → Core → Daemon
```

Core handles:
- Readiness gating
- Credentials injection
- Event stream splitting
- Cursor management
