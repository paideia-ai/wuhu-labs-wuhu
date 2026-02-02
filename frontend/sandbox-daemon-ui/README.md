# Sandbox Daemon UI

Minimal React UI for interacting with the sandbox daemon.

## Features

- Configure daemon URL and JWT token
- Send prompts to the daemon
- Watch live SSE events with manual stream parsing (supports Authorization
  header)
- Auto-scroll event log

## Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

The static output is in `dist/`.

## Usage

1. Enter the daemon URL (e.g., `https://your-daemon.modal.run`)
2. If JWT is enabled, enter a token (admin or user scope)
3. Click "Start Stream" to connect to the event stream
4. Type a prompt and click "Send" to send it to the daemon

## Production Notes

This UI uses `fetch()` with manual SSE parsing instead of `EventSource` because:

- `EventSource` doesn't support custom headers like `Authorization`
- The fetch approach allows sending JWT tokens for authenticated SSE streams
