# Stage 5.2: CLI Binary for Sandbox

## CLI Binary

- Deno script bundled and installed by setup script
- Calls Core API from within sandbox
- Commands:
  - `wuhu past-sessions query '<keyword>'` - search past sessions via FTS
  - `wuhu past-sessions get <session-id>` - retrieve full session log
- Binary instead of MCP because Pi agent doesn't support MCP
- Can later wrap as local stdio-based MCP if needed

## Validates

- Smoke test script (`scripts/smoke-session-query.ts`)
- Tests CLI → Core API → FTS flow end-to-end
- Validates from within sandbox environment
