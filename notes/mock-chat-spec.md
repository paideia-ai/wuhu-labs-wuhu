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
 *  - customType: "interruption" — user interrupted the agent (ends the turn)
 *  - customType: "agent-end" — marks end of agent work (ends the turn)
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
4. Emits an `agent-end` custom entry to close the turn.

No `agent-start` is emitted. The user message is the source of truth for when
a turn begins.

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
  new guidance in the **same logical turn**.
- Follow-up messages are consumed **after the agent finishes all work** for the
  current turn:
  - The current agent block is closed and an `agent-end` is emitted.
  - Each follow-up starts a fresh turn with a new agent block (no
    `agent-start` — the user message is the turn boundary).
- `interrupt()` aborts the current generation and adds an "interruption"
  custom entry. Both `interruption` and `agent-end` are turn-ending markers.
  Duration is computed from the user message timestamp to the turn-ending
  marker timestamp.

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
│   ├── CustomEntry (interruption, agent-end → duration label)
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

Duration is computed from the user message that started the turn to the
turn-ending marker (`agent-end` or `interruption`).

For each turn-ending entry in `history`, the UI:

1. Walks backwards to find the most recent `user-message`.
2. Stops if it encounters another turn-ending marker first (that belongs to an
   earlier turn).
3. If a matching `user-message` is found, compute:

> Worked for X seconds

where `X` is derived from `turnEnd.timestamp - userMessage.timestamp`
(formatted as `Ns` or `Nm Ns`).

This means:

- Steers and additional agent blocks between the user message and the
  turn-ending marker are treated as part of the **same** turn.
- Multiple turns in a session are handled by the "stop at previous turn-end"
  rule.
- Both `agent-end` and `interruption` are turn-ending markers, so duration
  labels are shown for interrupted turns too.

To classify a user message's `PromptKind`, walk backwards from it:
- **Turn-end found first** (`agent-end` or `interruption`) → `followUp`
  (previous turn finished, this starts a new one).
- **Another user-message found first** (no turn-end in between) → `steer`
  (same turn, agent is still working).
- **Nothing found** (start of history) → `fresh` (very first prompt).

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

---

## 11. History Projection / View Model

The raw `SessionSnapshot.history` is a low-level event log. The UI should not
have to reason directly about `agent-end` / `interruption` entries or how
steers and follow-ups are interleaved with tool calls.

Instead, we define a projection layer that derives a richer view model from the
raw history. The goals:

- Make it trivial for React components to render:
  - Turns (user prompt + agent work)
  - Agent blocks (batches of tools + assistant messages)
  - "Worked for X" labels
  - Folded traces vs expanded traces
- Support advanced behaviors:
  - Only show extra details for the **last active** batch of bash calls.
  - Collapse completed work under a "Worked for X minutes" summary.
  - Treat **steer** and **follow-up** prompts differently while still working
    with the real backend’s limitations.

### 11.1 Types

#### Block end reason

```ts
type BlockEndReason =
  | 'completed'      // true agent-end
  | 'interrupted'    // interrupted with no agent-end
  | 'steered'        // block ended because steer(s) arrived
  | 'followUpStart'  // block ended because a follow-up started a new turn
```

#### Agent block view

```ts
interface AgentBlockView {
  /** id of the underlying agent-block HistoryEntry */
  id: string

  /** Millisecond timestamps, aligned with HistoryEntry timestamps */
  startedAt: number
  endedAt: number | null

  /**
   * Why this block stopped.
   * - null → still streaming / active
   * - 'completed' → saw an agent-end for this turn
   * - 'interrupted' → saw an interruption with no agent-end
   * - 'steered' → we stopped because steer message(s) arrived
   * - 'followUpStart' → we stopped because a follow-up started a new turn
   */
  endReason: BlockEndReason | null

  /**
   * Tool/assistant items grouped for display.
   * Derived via tool-grouping.ts (RenderBlock[]).
   */
  renderBlocks: RenderBlock[]

  /**
   * The id of the last assistant-message inside this block, if any.
   * Used so we can render a "final answer" summary without double-rendering
   * it from renderBlocks.
   */
  finalAssistantMessageId: string | null

  /**
   * True when this is the last agent block for its turn. Used for decisions
   * like:
   *   - show more details for the last execution block
   *   - fold earlier blocks under a "Worked for X" summary
   */
  isLastBlockInTurn: boolean
}
```

#### Turn view

```ts
type PromptKind = 'fresh' | 'followUp' | 'steer'

interface TurnView {
  /** Stable id for the turn (e.g. derived from the first user message id). */
  id: string

  /** When the turn started (timestamp of the first user message for this turn). */
  startedAt: number

  /**
   * When the turn ended.
   * - For completed turns: timestamp of the matching agent-end.
   * - For interrupted turns: timestamp of the interruption.
   * - For active turns: null.
   */
  endedAt: number | null

  /** The originating user message for this turn. */
  prompt: {
    id: string
    text: string
    kind: PromptKind  // 'fresh', 'followUp', or 'steer'
  }

  /**
   * Agent blocks belonging to this turn, in chronological order.
   * There may be multiple blocks in a single turn when steers arrive mid-way.
   */
  blocks: AgentBlockView[]
}
```

#### Projection result

```ts
interface MockChatProjection {
  /** All turns in chronological order (completed + active). */
  turns: TurnView[]

  /** The currently-active turn, if any. Convenience alias for turns.at(-1) where endedAt == null. */
  activeTurn: TurnView | null
}
```

The projection is **pure**: given a `SessionSnapshot.history`, it produces a
`MockChatProjection` without mutating inputs.

### 11.2 Classification: steer vs follow-up

The real backend cannot reliably tell whether a user message was manually
entered vs queued, so the projection must infer **steer** vs **follow-up**
based on context.

Rule (for both the real backend and mock session):

- Let `U` be a user message in the raw history.
- Look at the **previous meaningful message**:
  - If the previous message is an **assistant** message (final answer or
    streaming), classify `U` as a **follow-up** (`PromptKind = 'followUp'`).
  - If the previous message is a **tool result** (or otherwise clearly inside
    the agent’s active tool-use phase), classify `U` as a **steer**
    (`PromptKind = 'steer'`).
- If there is no previous message (first turn), classify as `PromptKind = 'fresh'`.

The mock session still exposes `queueMode: 'steer' | 'followUp'` and separate
steer/follow-up queues. The projection uses the classification above to set
`prompt.kind` so the UI behaves like it would with the real backend.

### 11.3 Turn boundaries

Turns are delimited by user messages and turn-ending markers (`agent-end` or
`interruption`). There is no `agent-start` entry.

- A new turn begins when:
  - A `user-message` arrives and there is **no active turn**, or
  - A `user-message` is classified as a **follow-up** (the previous turn has
    already ended with a turn-ending marker).

- A turn ends when:
  - We see an `agent-end` → the last block's `endReason = 'completed'`
    and the turn's `endedAt` is that timestamp.
  - Or we see an `interruption` → the last block's
    `endReason = 'interrupted'` and the turn's `endedAt` is the interruption
    timestamp.

To classify a user message, walk backwards:
- **Turn-end found first** → `followUp` (new turn).
- **Another user-message found first** → `steer` (same turn).
- **Nothing found** → `fresh` (first prompt).

Steers **do not** end a turn. They may cause:

- The current agent block to be marked with `endReason = 'steered'`.
- A new agent block to start under the **same** turn, continuing work with the
  new guidance from the steer message(s).

Follow-ups **do** start a new turn, but only after the previous turn has ended.
The transition between turns is:

- Turn N:
  - ends with `agent-end` or `interruption`.
- Turn N+1:
  - begins with a `user-message` classified as `PromptKind = 'followUp'`.

### 11.4 Blocks inside a turn

Within a turn:

- Each `agent-block` history entry becomes one `AgentBlockView`.
- Exactly one block per turn can be active (where `endedAt === null` and
  `endReason === null`).
- `isLastBlockInTurn` is `true` for the last block of the turn.

Block end reasons:

- `completed`:
  - A completed turn where an `agent-end` was observed.
  - The block that was active when the agent finished gets
    `endReason = 'completed'`.
- `interrupted`:
  - No `agent-end` was seen for this turn, but an `interruption` custom entry
    was emitted.
  - The block that was active at interruption time gets
    `endReason = 'interrupted'`.
- `steered`:
  - During a running turn, one or more steer messages arrived.
  - The block that was active when we flushed those steers into history gets
    `endReason = 'steered'`, and a new block is opened (same turn) for the
    continued work under the new guidance.
- `followUpStart`:
  - When we want to explicitly mark that a block ended because the next
    **turn** started from a follow-up (optional; can be omitted if not used
    by the UI).

### 11.5 Worked-for label in the projection

The projection does **not** store a `workedForLabel` string. Instead:

- Duration is derived from the user message that started the turn to the
  turn-ending marker (`agent-end` or `interruption`) as described in
  section 5.
- A helper (e.g. `getDurationLabel(history, endIndex)`) is used at render time
  to compute `"Worked for X"` for the turn that ended at that marker.

This keeps the projection purely structural (boundaries, reasons, relationships)
and leaves formatting decisions to the UI.
