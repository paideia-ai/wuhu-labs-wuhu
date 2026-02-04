export interface StreamEnvelope<TEvent = unknown> {
  cursor: number
  event: TEvent
}

export type SandboxDaemonEventSource = 'daemon' | 'agent'

export interface SandboxDaemonBaseEvent {
  source: SandboxDaemonEventSource
  type: string
  [key: string]: unknown
}

export interface SandboxDaemonAgentEventPayload {
  type: string
  [key: string]: unknown
}

export interface SandboxDaemonAgentEvent extends SandboxDaemonBaseEvent {
  source: 'agent'
  payload: SandboxDaemonAgentEventPayload
}

export interface SandboxDaemonDaemonEvent extends SandboxDaemonBaseEvent {
  source: 'daemon'
}

export type SandboxDaemonEvent =
  | SandboxDaemonAgentEvent
  | SandboxDaemonDaemonEvent

export type AgentRole = 'user' | 'assistant' | 'tool' | 'system'

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error'

export interface ToolCallSummary {
  id: string
  name: string
}

export interface UiMessage {
  id: string
  role: AgentRole
  title: string
  text: string
  thinking?: string
  toolCalls?: ToolCallSummary[]
  status: MessageStatus
  cursor?: number
  timestamp?: string
}

export type ToolActivityStatus = 'running' | 'done' | 'error'

export interface ToolActivity {
  id: string
  toolName: string
  status: ToolActivityStatus
  output: string
  updatedAt: string
}

export type AgentStatus =
  | 'Idle'
  | 'Queued'
  | 'Responding'
  | `Running ${string}`

export interface CodingUiState {
  cursor: number
  messages: UiMessage[]
  activities: ToolActivity[]
  lastEventType?: string
  agentStatus: AgentStatus
}

export const initialCodingUiState: CodingUiState = {
  cursor: 0,
  messages: [],
  activities: [],
  lastEventType: undefined,
  agentStatus: 'Idle',
}

export type ControlEventType =
  | 'sandbox_ready'
  | 'repo_cloned'
  | 'repo_clone_error'
  | 'init_complete'
  | 'prompt_queued'
  | 'daemon_error'
  | 'sandbox_terminated'
  | string

export interface SandboxControlEvent {
  type: ControlEventType
  timestamp?: number
  [key: string]: unknown
}

export interface ControlUiState {
  cursor: number
  lastEventType?: string
  statusLabel: string
  error?: string
  prompts: Array<{
    cursor: number
    message: string
    timestamp?: number
    streamingBehavior?: 'steer' | 'followUp'
  }>
}

export const initialControlUiState: ControlUiState = {
  cursor: 0,
  lastEventType: undefined,
  statusLabel: 'Unknown',
  error: undefined,
  prompts: [],
}
