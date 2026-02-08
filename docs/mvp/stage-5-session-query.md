# Stage 5: Session Query

## FTS Indexing (Postgres)

- Index human input
- Index AI message to human
- Do NOT index: tool calls, tool results, reasoning/reasoning summary

## HTTP API Endpoints

1. `POST /sessions/search` - FTS query across sessions
2. `GET /sessions/:id` - Get session log (DB version, not raw - excludes unused metadata)

## CLI Binary for Sandbox

- Deno script bundled and installed by setup script
- Calls core API from within sandbox
- Commands:
  - `wuhu past-sessions query '<keyword>'`
  - `wuhu past-sessions get <session-id>`
- Binary instead of MCP because Pi agent doesn't support MCP
- Can later wrap as local stdio-based MCP if needed

## Validates

- FTS returns relevant sessions
- Agents can query past sessions from within sandbox
- CLI works end-to-end
