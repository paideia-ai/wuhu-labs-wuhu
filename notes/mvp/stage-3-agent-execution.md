# Stage 3: Pi Agent Execution

## Enable Persistent Sessions

- Remove `--no-session` flag from `pi-agent-provider.ts`
- Pi will maintain session logs
- Track session ID locally (SQLite or file) so daemon knows if session exists
- On daemon start: check for existing session → resume instead of create new
- Single persistent session per sandbox/task

## Integrate sandbox-daemon-ui into main web app

- Move UI from `web/packages/sandbox-daemon-ui/` into `web/packages/app/`
- Delete standalone sandbox-daemon-ui package (not in Deno workspace anyway)
- Drop SPA direct-connection complexity
- Web app proxies SSE from sandbox daemon (simpler architecture)

## Task Creation

- Now includes initial prompt (repo already added in Stage 2)
- Core passes the initial prompt to the daemon during `/init`
- Daemon stores it and fires the prompt only after repo initialization finishes

## LLM Credentials

- Core passes LLM API keys to sandbox daemon via `POST /credentials`
  - `llm.openaiApiKey` (from core env)
  - `llm.anthropicApiKey` (from core env)
  - Call early in sandbox startup so the daemon can configure agent providers

## Agent Chat UI

- Embedded in task detail page
- SSE proxied through web app → daemon
- Can send follow-up prompts to agent

## Validates

- Pi agent runs and responds
- Session persistence survives daemon restart
- End-to-end chat flow works
