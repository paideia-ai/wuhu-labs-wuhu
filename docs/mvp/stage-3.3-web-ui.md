# Stage 3.2: Web UI for Agent Chat

Wire up the web UI to Core API. Web never talks to daemon directly.

## Prerequisites

- Stage 3.1 complete (Core API works, validated by script)

## Task Creation

Update `web/packages/app/app/routes/_index.tsx`:

- Add prompt textarea to create form
- POST to Core `/sandboxes` with repo + prompt

## Task Detail Page

Update `web/packages/app/app/routes/sandboxes.$id.tsx`:

- Subscribe to `GET /api/sandboxes/:id/stream/control` for status
- Subscribe to `GET /api/sandboxes/:id/stream/coding` for chat
- Show status badge from control channel
- Show messages from coding channel
- Send prompts via `POST /api/sandboxes/:id/prompt`
- Abort via `POST /api/sandboxes/:id/abort`

## Web Proxies to Core

Add routes in web that proxy to Core API:

```
/api/sandboxes/* → Core /sandboxes/*
```

Or configure web to call Core directly in loaders/actions (already done for other endpoints).

## UI Components

Keep modular structure:

```
web/packages/app/app/
├── lib/
│   └── sandbox/
│       ├── types.ts           # Event types, UI state
│       ├── reducer.ts         # reduceEnvelope logic
│       └── use-sandbox.ts     # Hook for SSE subscription
├── routes/
│   └── sandboxes.$id.tsx      # Page component (thin)
```

Do NOT inline everything into the route file.

## Tests

Migrate from old `sandbox-daemon-ui`:

- `reducer.test.ts` — adapt to Deno test
- `sample-stream.sse` — restore fixture
- Test reducer logic with fixture data

## Validates

- End-to-end: create task with prompt → see agent respond → send follow-up
- UI shows control status (ready, cloning, etc.)
- UI shows coding messages (agent chat)
- All traffic goes through Core, no pod IPs in web code
