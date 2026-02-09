# Wuhu Session Streaming Protocol v2 — Design Document

## 1. Problem Statement

Wuhu must present a unified session view for coding agent runs backed by two
fundamentally different agent runtimes:

| Concern | Pi (via SDK) | Codex (via app-server) |
|---|---|---|
| Entry IDs | 8-char hex, assigned **after** streaming completes (`appendMessage` in `session-manager.ts:824`) | `call_id` / generated ID assigned **at event emission** by the app-server (`bespoke_event_handling.rs:158`) |
| Streaming deltas | `text_delta`, `thinking_delta`, `toolcall_delta` each carry `contentIndex` + accumulated `partial` message | `OutputTextDelta`, `ReasoningTextDelta`, `AgentMessageDelta` carry only a string `delta` scoped to an `item_id` |
| Session format | Append-only JSONL with tree structure (`parentId` per entry), entry types: message, compaction, branch_summary, custom, label | Append-only JSONL rollout (`RolloutLine`), no per-entry ID, variants: `SessionMeta`, `ResponseItem`, `Compacted`, `TurnContext`, `EventMsg` |
| Token usage | `Usage { input, output, cacheRead, cacheWrite, totalTokens, cost }` | `TokenUsage { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens }` |
| Addressing scheme | Entry ID (8-char hex) | No canonical per-line ID; lines identified by JSONL offset or `call_id`/`turn_id` on events |

The protocol must reconcile these into a single append-only event log that
supports: offline caching (web OPFS, Swift native), incremental sync, and live
streaming — all with correctness guarantees.

---

## 2. Design Goals (restated from requirements)

1. **Streaming**: Real-time message deltas visible in the UI, reconciling Pi's
   late-ID-assignment with Codex's eager-ID model.
2. **Addressability**: Every entry in the log must be addressable, even for
   Codex whose rollout format lacks per-entry IDs.
3. **Backend neutrality**: The protocol is the canonical shape; adapters in the
   daemon translate Pi/Codex events into it.
4. **Offline + sync**:
   - (a) Fetch full session log at version V.
   - (b) Fetch incremental patch V₁→V₂, combinable with local cache to produce
     identical result to (a) at V₂.
   - (c) Live SSE stream from version V that produces patches functionally
     equivalent to (b).
5. **Side-channel state**: Token usage, queue mode (steer/followUp), transient
   status — carried alongside but separable from the persistent log.

---

## 3. Core Abstraction: The Session Event Log

### 3.1 Model

A session is an **append-only, totally-ordered sequence of events**, each
assigned a monotonically increasing integer **sequence number** (`seq`). This is
analogous to the existing daemon `cursor` but elevated to protocol-level
concept.

```
SessionLog = SessionHeader + Event[0] + Event[1] + ... + Event[N]
```

The `seq` is the authoritative version. At any point, the **version** of a
session log is `max(seq)` of all events it contains (or 0 for empty).

### 3.2 Why not CRDTs

CRDTs solve concurrent multi-writer merge. Our system has a **single
authoritative writer** (the daemon) and **multiple readers** (web, iOS, macOS).
This is a classic **event sourcing / replication log** problem, not a CRDT
problem. Using seq-indexed append-only logs gives us:

- Trivial consistency: replay events 0..N always produces the same state.
- Trivial sync: "give me events since seq X" is O(1) to describe, O(k) to
  transmit where k = new events.
- Trivial caching: store events locally, only fetch what's new.

### 3.3 Event Envelope

```typescript
interface SessionEvent {
  /** Monotonically increasing, 1-indexed, assigned by daemon. */
  seq: number

  /** Unix timestamp in milliseconds. */
  ts: number

  /** Discriminated union tag. */
  type: string

  /** Event-specific payload. */
  [key: string]: unknown
}
```

Every event has `seq` + `ts` + `type`. The `seq` is assigned by the daemon's
event store upon ingestion — it is never set by the agent runtime.

---

## 4. Event Types

### 4.1 Session Lifecycle

```typescript
// First event in every session log.
{
  type: "session_start"
  seq: 1
  ts: ...
  sessionId: string          // UUID
  agentBackend: "pi" | "codex"
  metadata: {                // Backend-specific metadata, opaque to protocol
    model?: string
    cwd?: string
    gitBranch?: string
    gitCommit?: string
    [key: string]: unknown
  }
}

{
  type: "session_end"
  seq: ...
  ts: ...
  reason: "completed" | "terminated" | "error"
  error?: string
}
```

### 4.2 Turns

```typescript
{
  type: "turn_start"
  seq: ...
  ts: ...
  turnId: string             // UUID, assigned by daemon
  // The user prompt that initiated this turn.
  prompt?: {
    text: string
    images?: string[]
    streamingBehavior?: "steer" | "followUp"
  }
}

{
  type: "turn_end"
  seq: ...
  ts: ...
  turnId: string
  status: "completed" | "interrupted" | "error"
  error?: string
}
```

### 4.3 Entries — The Core Content Model

An **entry** is a logical unit of session content: a user message, an assistant
message, a tool call, a tool result, a reasoning block, etc. Entries have
**lifecycle**: they are opened, may be streamed into, and are closed.

```typescript
{
  type: "entry_start"
  seq: ...
  ts: ...
  turnId: string
  entryId: string            // Assigned by daemon (see §5 ID strategy)
  entryType: EntryType       // Discriminant (see below)
  // Initial snapshot of the entry. For non-streamed entries, this is complete.
  data: EntryData
}

{
  type: "entry_delta"
  seq: ...
  ts: ...
  entryId: string
  // Describes what changed. Structure depends on entryType.
  delta: EntryDelta
}

{
  type: "entry_end"
  seq: ...
  ts: ...
  entryId: string
  // Final authoritative snapshot. Clients SHOULD replace any accumulated
  // delta state with this. This is the "truth".
  data: EntryData
  // If the daemon assigned a provisional streaming ID and the backend
  // later provided a persistent ID, map it here. (See §5.)
  persistentId?: string
}
```

### 4.4 Entry Types

```typescript
type EntryType =
  | "user_message"
  | "assistant_message"
  | "thinking"               // Reasoning/thinking block
  | "tool_call"              // Generic: shell, file, MCP, custom, web search
  | "tool_result"
  | "plan"                   // Codex plan items
  | "compaction"             // Context compaction summary
  | "system"                 // System messages, errors, info
```

### 4.5 Entry Data Shapes

```typescript
// For user_message / assistant_message:
interface MessageEntryData {
  role: "user" | "assistant"
  text: string
  // For assistant messages, thinking/reasoning can be inline or separate entries.
}

// For tool_call:
interface ToolCallEntryData {
  toolName: string
  callId: string             // Correlation ID to match with tool_result
  arguments?: string         // JSON string of arguments
  command?: string           // For shell commands
  cwd?: string
  status: "running" | "completed" | "error" | "awaiting_approval"
  output?: string
  exitCode?: number
  durationMs?: number
}

// For tool_result:
interface ToolResultEntryData {
  callId: string             // Matches tool_call.callId
  output: string
  isError?: boolean
}

// For thinking:
interface ThinkingEntryData {
  text: string
  summary?: string[]
}

// For compaction:
interface CompactionEntryData {
  summary: string
}
```

### 4.6 Delta Shapes

Deltas are designed for **streaming text** into an entry:

```typescript
// Text append delta (most common — used for assistant_message, thinking, tool output)
interface TextAppendDelta {
  op: "text_append"
  text: string
  // Optional: which content block this appends to (for multi-block entries)
  contentIndex?: number
}

// Status change delta (for tool_call entries)
interface StatusChangeDelta {
  op: "status_change"
  status: string
  output?: string            // Incremental output append
  exitCode?: number
}

// Summary append delta (for thinking entries with streaming summaries)
interface SummaryAppendDelta {
  op: "summary_append"
  summaryIndex: number
  text: string
}

type EntryDelta = TextAppendDelta | StatusChangeDelta | SummaryAppendDelta
```

### 4.7 Side-channel Events (Non-persistent)

These carry transient state. They are part of the event stream (so they get a
`seq`) but clients **MAY** discard them from offline cache without loss of
session integrity.

```typescript
{
  type: "token_usage"
  seq: ...
  ts: ...
  turnId?: string
  usage: {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens?: number
    totalTokens: number
  }
  // Optional: running total for the session
  sessionTotal?: { ... }
  // Optional: cost in USD
  cost?: {
    input: number
    output: number
    cacheRead: number
    total: number
  }
}

{
  type: "status"
  seq: ...
  ts: ...
  agentStatus: "idle" | "queued" | "responding" | "running_tool"
  toolName?: string          // When status is "running_tool"
  queuedPrompts?: number     // Number of queued steer/followUp messages
}

{
  type: "heartbeat"
  seq: ...
  ts: ...
}
```

---

## 5. ID Strategy — Reconciling Pi's Late IDs with Codex's Eager IDs

This is the hardest design problem. The solution:

### 5.1 Daemon-assigned provisional IDs

The daemon assigns every `entry_start` a **provisional `entryId`** immediately
upon emission. This is a UUID (or short-UUID) generated by the daemon, not by
the agent backend. This means:

- For Codex: the daemon translates `call_id` / app-server `item_id` into its
  own `entryId` at the adapter layer. The Codex-side ID is stored in the entry
  data as `callId` but is not the protocol-level `entryId`.
- For Pi: the daemon generates an `entryId` at `message_start` time, before Pi
  has assigned its own session entry ID. The Pi entry ID (8-char hex) arrives
  later.

### 5.2 Persistent ID mapping at `entry_end`

When streaming completes and the backend assigns a persistent ID (Pi's
`appendMessage` return value), the `entry_end` event carries a `persistentId`
field:

```typescript
{
  type: "entry_end"
  entryId: "wuhu-provisional-abc123"   // Daemon's provisional ID
  persistentId: "e5f6a7b8"            // Pi's session entry ID
  data: { ... }
}
```

Clients that need to cross-reference with the backend's native session file can
build a `provisionalId → persistentId` map from `entry_end` events.

For Codex, `persistentId` is omitted (or set equal to `entryId`) because Codex
has no separate persistent ID lifecycle.

### 5.3 Why not wait for the persistent ID?

Blocking `entry_start` until the persistent ID is known would defeat streaming.
The provisional ID approach means:

- Deltas reference the provisional ID immediately.
- The UI can render content in real-time using the provisional ID.
- At `entry_end`, the mapping is sealed. Any local index keyed by provisional
  ID remains valid.
- The `data` snapshot in `entry_end` is authoritative, so even if a client
  missed some deltas, it can reconstruct the final state.

### 5.4 For Codex rollout lines: offset as implicit ID

The Codex rollout format is append-only JSONL with no per-line IDs. The daemon
adapter for Codex assigns `entryId` based on a composite: `codex-{turnId}-{itemIndex}` where `itemIndex` is the zero-based index of the item within the
turn. Since the rollout is append-only and turns are sequential, this is stable
and deterministic.

If a stable rebase-safe patch to Codex is warranted (see §10), it would be to
add optional `item_id` fields to `RolloutLine`, which would simplify the
adapter. But the offset-based approach works without upstream changes.

---

## 6. Sync Protocol

### 6.1 Snapshot (Full Fetch)

```
GET /sessions/{sessionId}/log?format=ndjson
```

Response: NDJSON stream of all `SessionEvent` objects, ordered by `seq`.

Response header: `X-Session-Version: {maxSeq}`

The client stores this locally (OPFS, SQLite, file). The local version is
`maxSeq`.

### 6.2 Incremental Fetch (Patch)

```
GET /sessions/{sessionId}/log?since={seq}&format=ndjson
```

Response: NDJSON stream of events where `event.seq > since`.

Response header: `X-Session-Version: {maxSeq}`

**Correctness invariant**: Given a local log at version V₁ and a patch
response for `since=V₁`, appending the patch events to the local log produces
a log identical to a full fetch at V₂ (the response's `X-Session-Version`).

This holds trivially because:
- Events are append-only (never mutated or reordered).
- `seq` is monotonically increasing with no gaps.
- The patch is exactly the suffix of the full log after position V₁.

### 6.3 Live Stream (SSE)

```
GET /sessions/{sessionId}/stream?since={seq}
Accept: text/event-stream
```

Response: SSE stream. Each SSE event:

```
id: {seq}
data: {JSON SessionEvent}

```

The `id` field enables the browser's native `Last-Event-ID` reconnection.

On reconnect, the client sends `Last-Event-ID` (or queries with `since=`), and
the server replays from that point. This is functionally equivalent to 6.2 but
delivered as a persistent stream.

**Heartbeats**: The server sends a heartbeat event every 15s:

```
id: {currentMaxSeq}
data: {"type":"heartbeat","seq":{currentMaxSeq},"ts":{now}}

```

### 6.4 Combined initial + live

For the common case (open a session UI that may or may not be running), the
client can:

1. Load local cache (if any) → local version V_local.
2. `GET /sessions/{id}/stream?since={V_local}` (SSE).
3. Receive backfill events (everything since V_local), then seamlessly
   transition to live events.

The server doesn't need to distinguish backfill from live — it just emits all
events from `since` onward, then keeps the connection open for new events.

### 6.5 Storage considerations for clients

**Web (OPFS)**:
- Store each session as a file in OPFS: `sessions/{sessionId}.ndjson`
- Append new events to the file.
- Store version metadata in a small index file or IndexedDB.
- For rendering, read and parse the NDJSON. For large sessions, maintain a
  parsed index (entry positions by seq) in IndexedDB.

**Swift (iOS/macOS)**:
- Store events in a local SQLite database.
- Table: `events(session_id TEXT, seq INTEGER, ts INTEGER, type TEXT, payload TEXT, PRIMARY KEY (session_id, seq))`
- Query: `SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq`
- This naturally supports both full-load and incremental sync.

---

## 7. Adapter Design

### 7.1 Pi Adapter (in sandbox-daemon)

The Pi adapter subscribes to `AgentSessionEvent` via the SDK and translates:

| Pi Event | Wuhu Event(s) |
|---|---|
| `turn_start` | `turn_start` |
| `message_start` (role=user) | `entry_start { entryType: "user_message" }` |
| `message_start` (role=assistant) | `entry_start { entryType: "assistant_message" }` |
| `message_update` + `text_delta` | `entry_delta { op: "text_append" }` |
| `message_update` + `thinking_delta` | Separate `entry_start { entryType: "thinking" }` + `entry_delta` |
| `message_update` + `toolcall_delta` | `entry_start { entryType: "tool_call" }` + `entry_delta` |
| `message_end` | `entry_end` (with `persistentId` from `appendMessage` return) |
| `tool_execution_start` | `entry_start { entryType: "tool_call" }` |
| `tool_execution_update` | `entry_delta { op: "status_change" }` |
| `tool_execution_end` | `entry_end` |
| `turn_end` | `turn_end` |
| `auto_compaction_end` | `entry_start/entry_end { entryType: "compaction" }` |

The adapter maintains a map of `contentIndex → entryId` for multi-block
streaming within a single assistant message. When Pi emits `text_delta` at
`contentIndex: 2`, the adapter looks up which `entryId` corresponds to content
block 2 (or creates a new entry if this is the first delta for that block).

**Persistent ID flow**:
1. `message_start` → adapter generates provisional `entryId`, emits
   `entry_start`.
2. `text_delta` / `thinking_delta` → adapter emits `entry_delta` referencing
   provisional `entryId`.
3. `message_end` → Pi's `session-manager.appendMessage()` returns an 8-char
   hex ID → adapter emits `entry_end` with `persistentId: "e5f6a7b8"`.

### 7.2 Codex Adapter (in sandbox-daemon)

The Codex adapter receives Codex app-server notifications (JSON-RPC over
WebSocket or via SSE from the Responses API proxy):

| Codex Notification | Wuhu Event(s) |
|---|---|
| `turn/started` | `turn_start` |
| `item/started` (AgentMessage) | `entry_start { entryType: "assistant_message" }` |
| `item/agentMessage/delta` | `entry_delta { op: "text_append" }` |
| `item/started` (CommandExecution) | `entry_start { entryType: "tool_call" }` |
| `item/commandExecution/outputDelta` | `entry_delta { op: "text_append", contentIndex: ... }` |
| `item/completed` | `entry_end` |
| `item/started` (FileChange) | `entry_start { entryType: "tool_call", toolName: "file_edit" }` |
| `item/started` (Reasoning) | `entry_start { entryType: "thinking" }` |
| `item/reasoning/summaryTextDelta` | `entry_delta { op: "summary_append" }` |
| `item/reasoning/textDelta` | `entry_delta { op: "text_append" }` |
| `turn/completed` | `turn_end` |
| `thread/tokenUsage/updated` | `token_usage` |
| `rawResponseItem/completed` | (internal, used for rollout replay) |

Codex's app-server already assigns `item_id` (string) to each `ThreadItem`.
The adapter uses this directly as the Wuhu `entryId`:
`entryId = codexItem.id`. No provisional/persistent split is needed because
Codex assigns IDs eagerly.

### 7.3 Adapter responsibilities

Both adapters are responsible for:
1. Generating `seq` (via the daemon's `InMemoryEventStore.append()`).
2. Assigning `entryId` when the backend doesn't provide one at start time.
3. Emitting `entry_end` with the authoritative `data` snapshot.
4. Emitting `token_usage` events from backend-specific usage structures.
5. Translating backend-specific error/interruption into `turn_end` with
   appropriate status.

---

## 8. State Reconstruction Rules

A client reconstructing the session UI state from a log follows these rules:

1. **Entries**: Maintain a map `entryId → EntryState`. On `entry_start`,
   create the entry. On `entry_delta`, apply the delta. On `entry_end`,
   replace the entry state with the `data` snapshot (authoritative).

2. **Turns**: Maintain a list of turns. On `turn_start`, push a new turn. On
   `turn_end`, finalize the turn status.

3. **Entry ordering**: Entries are ordered by their `entry_start.seq`. Within a
   turn, entries appear in the order they started.

4. **Token usage**: Keep a running total. On `token_usage` events, update the
   displayed total. These are idempotent if `sessionTotal` is provided.

5. **Status**: On `status` events, update the transient agent status display.
   These are ephemeral and should not be persisted for offline replay (but
   caching is harmless).

6. **Missed deltas**: If a client connects mid-stream and receives `entry_end`
   for an entry it never saw `entry_start` for, it can reconstruct the entry
   from the `entry_end.data` snapshot alone. The `entry_end` is always
   self-sufficient.

7. **Missed `entry_end`**: If a session terminates without `entry_end` for an
   active entry (crash, disconnect), the entry is in an incomplete state. The
   client should display it as-is with a visual indicator. On next sync, if
   `entry_end` has been persisted, the client will receive it.

---

## 9. Persistence Architecture

### 9.1 Daemon layer

The daemon maintains an `InMemoryEventStore` (as today) but now stores
`SessionEvent` objects instead of raw agent events. The event store is the
single source of truth for the session during the sandbox lifetime.

On each `turn_end`, the daemon:
1. Persists events to local NDJSON file (`~/.wuhu/sessions/{sessionId}.ndjson`)
   as crash recovery.
2. POSTs new events to Core API (best-effort, with retry).

### 9.2 Core (server) layer

Core receives events and stores them in PostgreSQL:

```sql
CREATE TABLE session_events (
  session_id  TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  ts          BIGINT  NOT NULL,
  type        TEXT    NOT NULL,
  payload     JSONB   NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX idx_session_events_type
  ON session_events (session_id, type);
```

The existing `messages` table can be derived from `session_events` via a view
or materialized view if needed for backward compatibility, but `session_events`
is the canonical store.

### 9.3 Raw log archival

The existing S3/Minio raw log archival continues to work: the daemon ships
raw agent events (NDJSON) to the archive endpoint. The Wuhu protocol events
are a separate, higher-level layer.

---

## 10. Upstream Patch Considerations

### 10.1 Pi — not needed

Pi's SDK already exposes all the events we need. The `message_end` event
returns the final message, and the session-manager's `appendMessage` return
value gives us the persistent ID. The adapter can capture this by subscribing
at the `AgentSession` level.

One **nice-to-have** patch: Emit the entry ID in the `message_end` event
directly (currently the SDK doesn't surface the return value of
`appendMessage` to subscribers). This would save the adapter from having to
hook into the session-manager internals. But this is a convenience, not a
necessity — the adapter can call `session.sessionManager.appendMessage()`
in its event handler and capture the returned ID.

### 10.2 Codex — not needed for core protocol

Codex's app-server already assigns `item_id` to every `ThreadItem`, and the
notification protocol provides `item/started`, `item/completed`, and delta
notifications with `item_id`. This is sufficient for the adapter.

The rollout JSONL format (used for session replay/archival) does lack per-line
IDs, but since we're consuming the **live event stream** (not replaying
rollouts), this doesn't block us. If we later need rollout replay (e.g., for
importing old sessions), we can use the JSONL line offset approach.

**Decision: No upstream patches required.** Both adapters can work with the
existing APIs. The integration is cleaner without patches, and avoids rebase
maintenance burden.

---

## 11. Wire Format Summary

### Request/Response

| Endpoint | Method | Description |
|---|---|---|
| `/sessions/{id}/log` | GET | Full or incremental fetch (NDJSON) |
| `/sessions/{id}/stream` | GET | SSE live stream |
| `/sessions/{id}/log` | Query: `?since={seq}` | Incremental patch |

### SSE Event Format

```
id: 42
data: {"seq":42,"ts":1706835605000,"type":"entry_delta","entryId":"abc123","delta":{"op":"text_append","text":"Hello"}}

```

### NDJSON Format (for full/incremental fetch)

```
{"seq":1,"ts":1706835600000,"type":"session_start","sessionId":"...","agentBackend":"pi","metadata":{}}
{"seq":2,"ts":1706835601000,"type":"turn_start","turnId":"...","prompt":{"text":"Fix the bug"}}
{"seq":3,"ts":1706835602000,"type":"entry_start","turnId":"...","entryId":"prov-001","entryType":"assistant_message","data":{"role":"assistant","text":""}}
{"seq":4,"ts":1706835602050,"type":"entry_delta","entryId":"prov-001","delta":{"op":"text_append","text":"I'll look"}}
{"seq":5,"ts":1706835602100,"type":"entry_delta","entryId":"prov-001","delta":{"op":"text_append","text":" at the code."}}
{"seq":6,"ts":1706835603000,"type":"entry_end","entryId":"prov-001","data":{"role":"assistant","text":"I'll look at the code."},"persistentId":"e5f6a7b8"}
{"seq":7,"ts":1706835604000,"type":"entry_start","turnId":"...","entryId":"prov-002","entryType":"tool_call","data":{"toolName":"bash","callId":"call-1","command":"grep -r 'bug' src/","status":"running"}}
...
```

---

## 12. Comparison with Current Architecture

| Aspect | Current (v1) | Proposed (v2) |
|---|---|---|
| Event format | Raw agent events wrapped in `SandboxDaemonAgentEvent` with opaque `payload` | Typed `SessionEvent` with structured `EntryData` |
| Addressing | Cursor (integer offset into raw event stream) | `seq` (integer) + `entryId` (string) per logical entry |
| Streaming | Two separate SSE streams (control + coding) | Single unified SSE stream, event types distinguish control vs content |
| Sync | No incremental sync; full re-stream on reconnect | `since=seq` incremental sync + SSE `Last-Event-ID` |
| Offline | Not supported | NDJSON/SQLite local cache with version tracking |
| Token usage | Embedded in raw agent payload | First-class `token_usage` event type |
| ID lifecycle | Not modeled | `entry_start` (provisional) → `entry_end` (persistent mapping) |
| Multi-backend | Pi only (Codex not integrated) | Adapter pattern for both Pi and Codex |

---

## 13. Migration Path

1. **Phase 1**: Implement the `SessionEvent` types and event store in the
   daemon. The Pi adapter translates pi-rpc events → `SessionEvent`.
   Existing SSE endpoint serves `SessionEvent` NDJSON. Frontend updated to
   consume new format.

2. **Phase 2**: Implement the Codex adapter. Add Codex app-server integration
   to the daemon (WebSocket JSON-RPC client or SSE proxy). Translate Codex
   notifications → `SessionEvent`.

3. **Phase 3**: Implement Core-level persistence (`session_events` table).
   Add incremental sync endpoints. Add offline caching to web frontend (OPFS).

4. **Phase 4**: Swift client support. Publish the protocol spec as a
   standalone document for the native client team.

---

## 14. Open Questions

1. **Two streams vs one**: The current architecture splits control (daemon
   lifecycle) and coding (agent activity) into separate SSE streams. The
   proposed design unifies them. Should we keep the split for backward
   compatibility, or fully unify? **Recommendation**: Unify. The `type`
   discriminant is sufficient for clients to filter. Two streams double
   connection overhead and complicate reconnection.

2. **Compression for large sessions**: For sessions with thousands of events,
   should we support gzip on the NDJSON responses? **Recommendation**: Yes,
   standard HTTP `Accept-Encoding: gzip` on the NDJSON endpoint. SSE does not
   compress well mid-stream but the initial backfill can benefit.

3. **Event pruning / compaction in the protocol**: When the agent performs
   context compaction, should the protocol support "replacing" a range of
   events with a compaction summary? **Recommendation**: No. Emit a
   `compaction` entry that summarizes what was compacted, but keep the
   original events in the log. The log is append-only; compaction is a
   content-level concern, not a protocol-level mutation.

4. **Max event size**: Tool outputs (e.g., large file reads) can be very
   large. Should we cap `entry_delta` / `entry_end` data sizes?
   **Recommendation**: Truncate tool output in the protocol layer to a
   configurable max (e.g., 100KB). The raw output is available in the
   archived raw logs if needed.
