# Mock Coding Agent Chat UI — Spec

## Overview

A mock coding agent chat page at `/mock-chat` that simulates a pi coding agent
session. Uses pi-mono types (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`)
for type alignment. Built entirely in React with shadcn components. Designed for
eventual replacement of the mock backend with a real SSE+POST server.

---

## 1. Session Interface

A single TypeScript interface that abstracts the session. Designed to be consumed
via `useSyncExternalStore`.

```ts
interface MockSession {
  /** Subscribe to state changes. Returns unsubscribe fn. */
  subscribe(callback: () => void): () => void

  /** Get current snapshot (referentially stable when unchanged). */
  getSnapshot(): SessionSnapshot

  // — Actions —
  sendMessage(text: string): void
  interrupt(): void
  setQueueMode(mode: 'steer' | 'followUp'): void
}

interface SessionSnapshot {
  history: HistoryEntry[]
  streamingMessage: StreamingMessage | null
  isGenerating: boolean
  queueMode: 'steer' | 'followUp'
  steerQueue: QueuedMessage[]
  followUpQueue: QueuedMessage[]
}
```

### History entries

```ts
type HistoryEntry =
  | { type: 'user-message'; id: string; text: string; timestamp: number }
  | { type: 'custom'; id: string; customType: string; content: string; timestamp: number }
  | { type: 'agent-block'; id: string; items: AgentBlockItem[]; startedAt: number; endedAt: number | null }

/** "custom" entries include:
 *  - customType: "interruption" — user interrupted the agent
 *  - customType: "agent-start" — marks beginning of agent work (for duration calc)
 *  - customType: "agent-end" — marks end of agent work (for duration calc)
 */
```

The `agent-block` groups all the work the agent did in response. Its `id` is the
id of its first item.

### Agent block items

```ts
type AgentBlockItem =
  | { type: 'assistant-message'; id: string; content: string; timestamp: number }
  | { type: 'reasoning-summary'; id: string; content: string; timestamp: number }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown>; timestamp: number }
  | { type: 'tool-result'; id: string; toolCallId: string; toolName: string; isError: boolean; timestamp: number }
```

Tool calls carry enough info for the UI grouping logic (see section 4).

### Streaming message

```ts
interface StreamingMessage {
  id: string
  content: string   // text accumulated so far
}
```

Only assistant text messages stream. Reasoning summaries, tool calls, and tool
results arrive as complete items into the agent block.

### Queued messages

```ts
interface QueuedMessage {
  id: string
  text: string
  timestamp: number
}
```

---

## 2. Mock Session Class

A `MockSession` class implements the interface above with simulated data.

### Conversation generation

On construction (or when `sendMessage` is called), the mock:

1. Picks a random number of tool-call turns (0–4).
2. For each tool-call turn:
   - Emits an assistant message (Anthropic style) or reasoning summary (OpenAI
     style), drawn from a **pool of markdown fragments**.
   - Emits 1–4 tool calls (random mix of read/grep/find/ls/bash/write/edit).
   - Emits corresponding tool results (immediately, as complete items).
3. After all tool-call turns, emits a final assistant message (summary), also
   from the markdown pool.
4. Emits an `agent-end` custom entry.

The constructor accepts a `style: 'anthropic' | 'openai'` option.

### Streaming simulation

When emitting an assistant message (NOT reasoning summary), the mock:
- Sets `streamingMessage` with incrementing content (character-by-character or
  chunk-by-chunk at ~30ms intervals).
- On completion, folds the message into the current agent block in `history`,
  sets `streamingMessage = null`.

### Steer & follow-up simulation

- `sendMessage()` adds to the appropriate queue based on current `queueMode`.
- If `isGenerating`, steer messages are **consumed after the current tool-call
  turn finishes**. All queued steers at that point are flushed into the
  history at once as user messages, and the agent continues working under the
  new guidance in the **same logical turn**:
  - No new `agent-start` is emitted.
  - The eventual `agent-end` still measures from the original `agent-start`.
- Follow-up messages are consumed **after the agent finishes all work** for the
  current turn:
  - The current agent block is closed and an `agent-end` is emitted.
  - Each follow-up starts a fresh turn with a new `agent-start` and agent
    block.
- `interrupt()` aborts the current generation, adds an "interruption" custom
  entry, and **does not** emit an `agent-end`. Interrupted turns therefore
  have no "Worked for" label.

### Referential stability

- `history` array reference only changes when a new entry is appended or the
  last agent block's items change.
- `streamingMessage` is the only high-frequency update path.
- Completed agent blocks and their items are frozen (never mutated).

---

## 3. React Integration

### Hook

```ts
function useMockSession(style: 'anthropic' | 'openai'): {
  snapshot: SessionSnapshot
  sendMessage: (text: string) => void
  interrupt: () => void
  setQueueMode: (mode: 'steer' | 'followUp') => void
}
```

Uses `useSyncExternalStore(session.subscribe, session.getSnapshot)`.

### Component tree

```
MockChatPage
├── Header (back link, style toggle, interrupt button)
├── HistoryList (memoized — only re-renders when history ref changes)
│   ├── UserMessageEntry
│   ├── CustomEntry (interruption, agent-start/end → duration label)
│   └── AgentBlockEntry (memoized when block is complete)
│       └── ToolGroupDisplay (UI grouping of tool calls)
├── StreamingMessageDisplay (re-renders on every streaming tick)
├── QueueSidebar (steer queue + follow-up queue)
└── InputArea (textarea, queue mode selector, send button)
```

---

## 4. Tool Call UI Grouping

This is a **render-time transformation** on `AgentBlockItem[]`. It does NOT
modify the session state.

### Grouping rules

Adjacent tool calls (ignoring tool results, which are hidden) are grouped by
category:

| Category      | Tools                     |
|---------------|---------------------------|
| Exploration   | read, grep, find, ls      |
| Mutation      | write, edit               |
| Execution     | bash                      |

Grouping does **not** cross category boundaries. Within one category group,
tools are reordered by tool kind but not across groups.

So the sequence: `read, ls, bash, read, read, write, read, bash` becomes:

1. **Exploration**: read + ls
2. **Execution**: bash
3. **Exploration**: read, read
4. **Mutation**: write
5. **Exploration**: read
6. **Execution**: bash

### Display rules

**Exploration & Mutation** — one line per tool kind present in the group:

- 1 file: `Read AGENTS.md`
- 2–3 files: `Read AGENTS.md, README.md, lib.ts`
- 4+ files: `Read 4 files`

For grep/find: `Grep 3 patterns` / `Find 2 patterns`
For ls: `List src, tests` (show final directory name)

**Execution (bash)** — one line per bash call, showing the command truncated to
one line with `...` for overflow. No wrapping. Show all bash calls.

### Tool results

No dedicated UI for tool results. They are tracked in the data model (for future
use) but not rendered.

---

## 5. Duration Label

Duration is computed from custom `agent-start` / `agent-end` entries, not from
the agent block itself.

For each `agent-end` entry in `history`, the UI:

1. Walks backwards to find the most recent `agent-start`.
2. Stops if it encounters another `agent-end` first (that end belongs to an
   earlier turn).
3. If a matching `agent-start` is found, compute:

> Worked for X seconds

where `X` is derived from `agent-end.timestamp - agent-start.timestamp`
(formatted as `Ns` or `Nm Ns`).

This means:

- Steers and additional agent blocks between `agent-start` and `agent-end` are
  treated as part of the **same** turn.
- Multiple turns in a session are handled by the "stop at previous agent-end"
  rule.

If interrupted (no `agent-end` for a given `agent-start`), **no duration label
is shown** for that work.

---

## 6. Markdown Rendering

Install `react-markdown` (with `remark-gfm` for GFM support).

Used for:
- Assistant message content
- Reasoning summary content

Code blocks get basic syntax highlighting via CSS (no heavy highlighting library
for now).

---

## 7. Anthropic vs OpenAI Style

| Aspect                | Anthropic                    | OpenAI                          |
|-----------------------|------------------------------|---------------------------------|
| Pre-tool-call block   | Assistant message (streamed) | Reasoning summary (not streamed)|
| Final response        | Assistant message (streamed) | Assistant message (streamed)    |
| Reasoning visible?    | No thinking blocks shown     | Summary shown as collapsed block|

The style toggle lives in the header. Changing it resets the session.

---

## 8. File Structure

```
app/
├── routes.ts                          # add route
├── routes/_index.tsx                  # add link
├── routes/mock-chat.tsx               # page component
└── lib/mock-chat/
    ├── types.ts                       # SessionSnapshot, HistoryEntry, etc.
    ├── mock-session.ts                # MockSession class
    ├── use-mock-session.ts            # React hook
    ├── fragments.ts                   # Pool of markdown fragments
    ├── tool-grouping.ts               # groupToolCalls() pure function
    └── components/
        ├── history-list.tsx           # Memoized history renderer
        ├── agent-block.tsx            # Agent block with tool groups
        ├── streaming-message.tsx      # Current streaming text
        └── input-area.tsx             # Textarea + queue mode + send
```

---

## 9. Dependencies to Install

```
deno add npm:react-markdown npm:remark-gfm
```

We import types from `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core` but
do NOT install them — we define our own types aligned with their shapes. This
avoids pulling in their heavy dependency trees (anthropic sdk, openai sdk, etc.)
into the web app.

---

## 10. Route Setup

In `routes.ts`:
```ts
route('mock-chat', 'routes/mock-chat.tsx'),
```

In `_index.tsx`, add a link:
```tsx
<Link to="/mock-chat">Mock Agent Chat</Link>
```
