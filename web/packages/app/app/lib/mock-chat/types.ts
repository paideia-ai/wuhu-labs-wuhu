import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@mariozechner/pi-ai'

// Re-export pi-ai types we reference elsewhere
export type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
}

// ---------------------------------------------------------------------------
// Tool names known to the pi coding agent
// ---------------------------------------------------------------------------

export type ExplorationTool = 'read' | 'grep' | 'find' | 'ls'
export type MutationTool = 'write' | 'edit'
export type ExecutionTool = 'bash'
export type BuiltinToolName = ExplorationTool | MutationTool | ExecutionTool

// ---------------------------------------------------------------------------
// Agent block items — the raw entries inside an agent working block
// ---------------------------------------------------------------------------

export interface AssistantMessageItem {
  type: 'assistant-message'
  id: string
  content: string
  timestamp: number
}

export interface ReasoningSummaryItem {
  type: 'reasoning-summary'
  id: string
  content: string
  timestamp: number
}

export interface ToolCallItem {
  type: 'tool-call'
  id: string
  toolName: string
  args: Record<string, unknown>
  timestamp: number
}

export interface ToolResultItem {
  type: 'tool-result'
  id: string
  toolCallId: string
  toolName: string
  isError: boolean
  timestamp: number
}

export type AgentBlockItem =
  | AssistantMessageItem
  | ReasoningSummaryItem
  | ToolCallItem
  | ToolResultItem

// ---------------------------------------------------------------------------
// History entries — the top-level list shown in the chat
// ---------------------------------------------------------------------------

export interface UserMessageEntry {
  type: 'user-message'
  id: string
  text: string
  timestamp: number
}

export interface CustomEntry {
  type: 'custom'
  id: string
  customType: 'interruption' | 'agent-start' | 'agent-end'
  content: string
  timestamp: number
}

export interface AgentBlockEntry {
  type: 'agent-block'
  id: string
  items: AgentBlockItem[]
  startedAt: number
  endedAt: number | null
}

export type HistoryEntry = UserMessageEntry | CustomEntry | AgentBlockEntry

// ---------------------------------------------------------------------------
// Streaming message — the currently-streaming assistant text
// ---------------------------------------------------------------------------

export interface StreamingMessage {
  id: string
  content: string
}

// ---------------------------------------------------------------------------
// Queued messages
// ---------------------------------------------------------------------------

export interface QueuedMessage {
  id: string
  text: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// Session snapshot — the full state exposed to React
// ---------------------------------------------------------------------------

export interface SessionSnapshot {
  history: HistoryEntry[]
  streamingMessage: StreamingMessage | null
  isGenerating: boolean
  queueMode: 'steer' | 'followUp'
  steerQueue: QueuedMessage[]
  followUpQueue: QueuedMessage[]
}

// ---------------------------------------------------------------------------
// Session interface — what React consumes via useSyncExternalStore
// ---------------------------------------------------------------------------

export interface Session {
  subscribe(callback: () => void): () => void
  getSnapshot(): SessionSnapshot
  sendMessage(text: string): void
  interrupt(): void
  setQueueMode(mode: 'steer' | 'followUp'): void
}

// ---------------------------------------------------------------------------
// Mock session options
// ---------------------------------------------------------------------------

export type AgentStyle = 'anthropic' | 'openai'
