# Stage 3.1: Core API for Sandbox Tasks

Core becomes the sole interface for sandbox operations. Web and CLI only talk to Core.

## Design Decisions

1. **Session persistence**: Store session file path in `/root/.wuhu/pi-session.json`
2. **Pi data dir**: Use Pi's default (`/root/.pi`), don't pollute workspace root
3. **Initial prompt timing**: Send to daemon ASAP, daemon decides when to fire (after repo ready)
4. **Prompt at creation**: Required. Default: `"Tell me what this repo is about"` for easy testing
5. **streamingBehavior**: Default to `followUp` (safe when agent is already streaming)
6. **LLM credentials**: OPENAI_API_KEY + ANTHROPIC_API_KEY only for now

## Credentials Flow

LLM API keys are injected into Core via environment variables (from `llm-api-keys` k8s secret).
Core is responsible for passing these to daemon via `POST /credentials` during sandbox init.

## New Core Endpoints

### POST /sandboxes

Extended to accept initial prompt:

```json
{
  "name": "optional-name",
  "repo": "org/repo-name",
  "prompt": "fix the bug in auth.ts"
}
```

- `prompt` is required. Default to `"Tell me what this repo is about"` if UI doesn't provide one.

Core flow:
1. Creates sandbox job (existing flow)
2. Waits for daemon ready (poll `/health` or similar)
3. Sends `POST /credentials` to daemon with LLM keys from Core's env
4. Sends `POST /init` with repo config + prompt to daemon
5. Daemon queues the prompt, fires after repo clone completes
6. Returns sandbox record (client can start listening to streams)

### POST /sandboxes/:id/prompt

Send follow-up prompt to running sandbox.

```json
{
  "message": "now add tests for that fix"
}
```

Core proxies to daemon's `/prompt` endpoint.

### POST /sandboxes/:id/abort

Abort current agent turn.

Core proxies to daemon's `/abort` endpoint.

### GET /sandboxes/:id/stream/control

SSE stream of daemon lifecycle events only.

Events:
- `sandbox_ready` — daemon is up, credentials sent
- `repo_cloned` / `repo_clone_error` — clone status
- `init_complete` — workspace initialized, ready for prompts
- `prompt_queued` — initial prompt sent to agent
- `daemon_error` — daemon-level error
- `sandbox_terminated` — sandbox killed

Envelope format:
```json
{
  "cursor": 1,
  "event": {
    "type": "sandbox_ready",
    "timestamp": 1234567890
  }
}
```

### GET /sandboxes/:id/stream/coding

SSE stream of agent/coding session events only.

Events (forwarded from daemon):
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

Same envelope format with cursor.

## Core Responsibilities

1. **Readiness gating** — Don't return from POST /sandboxes until daemon is ready
2. **Credentials injection** — Core sends LLM keys to daemon
3. **Event splitting** — Single upstream from daemon, two downstream channels
4. **Cursor tracking** — Client can resume from cursor on reconnect

## Daemon Changes

Minimal:
- Ensure all events have consistent envelope format
- Emit `init_complete` after workspace setup
- Queue initial prompt, fire after repo clone completes
- No major architectural changes needed

## Architecture Note

Original discussion considered SSE proxy in web app server. **Revised decision**: SSE proxy lives in Core.

Rationale:
- Core is the single point of contact for all sandbox operations
- Web should not know about pod IPs or daemon endpoints
- Core can add readiness gating, auth, logging in one place
- Web becomes a thin UI layer calling Core API

## Deliverable

Script: `scripts/sandbox-task.ts`

```bash
# Create task with prompt, stream until first turn completes
deno run -A scripts/sandbox-task.ts \
  --repo=paideia-ai/some-repo \
  --prompt="fix the bug in auth.ts"

# Send follow-up to existing sandbox
deno run -A scripts/sandbox-task.ts \
  --id=abc123 \
  --prompt="now add tests"

# Just stream (control + coding) from cursor
deno run -A scripts/sandbox-task.ts \
  --id=abc123 \
  --cursor=42
```

The script:
1. Calls Core API (not daemon directly)
2. Subscribes to both streams
3. Prints events to stdout
4. Can send prompts interactively

## Validates

- Core API is complete for sandbox task lifecycle
- SSE split works correctly
- No direct daemon access needed by clients
- Script can drive a full coding session without web UI
