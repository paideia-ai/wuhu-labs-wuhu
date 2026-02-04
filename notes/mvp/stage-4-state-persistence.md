# Stage 4: State Persistence

## Turn Definition

A turn means: human message → AI tool call loop → AI final summary (no more tools)

## Split State Approach

### UI State (Postgres)

- Converted messages/tool calls for display
- Each message carries cursor for SSE resume
- Flow:
  1. React Router loader fetches messages from DB up to cursor
  2. Browser starts SSE from cursor → web app → sandbox daemon
  3. No gaps, no duplicates

### Raw Logs (S3/Minio)

- Full Pi agent session logs
- Upload after each turn completes
- Immutable archive for debugging/replay

## Data Flow (MVP)

- Sandbox daemon calls core API directly (everything in-cluster)
- After each turn: daemon POSTs UI state to core API, uploads raw log to Minio

## Future Concern (Deferred)

- Cloud sandboxes won't have direct access to internal API
- Options: public ingress endpoint, message queue, WebSocket tunnel
- Not solving now - MVP uses in-cluster direct calls

## Validates

- Session state persists to DB
- Raw logs archived to S3
- SSE resume from cursor works
- UI loads history + streams new events seamlessly
