import type {
  CodingUiState,
  SandboxControlEvent,
  SandboxDaemonAgentEvent,
  SandboxDaemonEvent,
  StreamEnvelope,
  ToolActivity,
  UiMessage,
} from './types.ts'
import {
  type AgentRole,
  type ControlUiState,
  initialCodingUiState,
  initialControlUiState,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatTimestamp(value?: number | string): string {
  const date = value ? new Date(value) : new Date()
  return date.toLocaleTimeString([], { hour12: false })
}

function coerceAgentEvent(
  event: SandboxDaemonEvent,
): SandboxDaemonAgentEvent | null {
  if (!event || typeof event !== 'object') return null
  if (event.source !== 'agent') return null
  const payload = (event as { payload?: unknown }).payload
  if (!isRecord(payload)) return null
  return event as SandboxDaemonAgentEvent
}

function extractMessageParts(message: unknown): {
  role: string
  text: string
  thinking: string
  toolCalls: { id: string; name: string }[]
  timestamp?: number
} {
  const record = isRecord(message) ? message : {}
  const role = typeof record.role === 'string' ? record.role : 'assistant'
  const timestamp = typeof record.timestamp === 'number'
    ? record.timestamp
    : undefined

  const parts = {
    text: '',
    thinking: '',
    toolCalls: [] as {
      id: string
      name: string
    }[],
  }

  const content = record.content
  if (typeof content === 'string') {
    parts.text = content
  } else if (Array.isArray(content)) {
    const toolCallById = new Map<string, { id: string; name: string }>()
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (
        isRecord(item) &&
        item.type === 'text' &&
        typeof item.text === 'string'
      ) {
        parts.text += item.text
      }
      if (
        isRecord(item) &&
        item.type === 'thinking' &&
        typeof item.thinking === 'string'
      ) {
        parts.thinking += item.thinking
      }
      if (isRecord(item) && item.type === 'toolCall') {
        const id = typeof item.id === 'string' ? item.id : ''
        const name = typeof item.name === 'string' ? item.name : 'tool'
        if (id) {
          toolCallById.set(id, { id, name })
        } else {
          parts.toolCalls.push({ id: name, name })
        }
      }
    }
    if (toolCallById.size) {
      parts.toolCalls.push(...toolCallById.values())
    }
  }

  return {
    role,
    text: parts.text,
    thinking: parts.thinking,
    toolCalls: parts.toolCalls,
    timestamp,
  }
}

function upsertMessage(messages: UiMessage[], message: UiMessage): UiMessage[] {
  const idx = messages.findIndex((m) => m.id === message.id)
  if (idx === -1) return [...messages, message]
  const next = [...messages]
  next[idx] = { ...next[idx], ...message }
  return next
}

function updateActivityFromEvent(
  activities: ToolActivity[],
  event: SandboxDaemonAgentEvent,
): ToolActivity[] {
  const payload = event.payload
  const type = payload.type
  if (
    type !== 'tool_execution_start' &&
    type !== 'tool_execution_update' &&
    type !== 'tool_execution_end'
  ) {
    return activities
  }
  const toolCallId = (payload as Record<string, unknown>).toolCallId
  const id = typeof toolCallId === 'string' ? toolCallId : `tool-${Date.now()}`
  const rawToolName = (payload as Record<string, unknown>).toolName
  const toolName = typeof rawToolName === 'string' ? rawToolName : 'tool'
  const outputRaw = (payload as Record<string, unknown>).partialResult ??
    (payload as Record<string, unknown>).result
  let output = ''
  if (isRecord(outputRaw)) {
    const content = outputRaw.content
    if (Array.isArray(content)) {
      output = content
        .map((item) =>
          isRecord(item) && item.type === 'text' ? String(item.text ?? '') : ''
        )
        .join('')
    }
  }
  const status: ToolActivity['status'] = type === 'tool_execution_end'
    ? ((payload as Record<string, unknown>).isError ? 'error' : 'done')
    : 'running'

  const updatedAt = formatTimestamp()

  const idx = activities.findIndex((a) => a.id === id)
  if (idx === -1) {
    return [
      {
        id,
        toolName,
        status,
        output,
        updatedAt,
      },
      ...activities,
    ].slice(0, 12)
  }
  const next = [...activities]
  next[idx] = {
    ...next[idx],
    status,
    output: output || next[idx].output,
    updatedAt,
  }
  return next.slice(0, 12)
}

function nextAgentStatus(
  current: CodingUiState['agentStatus'],
  event: SandboxDaemonAgentEvent,
): CodingUiState['agentStatus'] {
  const t = event.payload?.type
  switch (t) {
    case 'turn_start':
    case 'message_start':
    case 'message_update':
      return 'Responding'
    case 'tool_execution_start':
    case 'tool_execution_update':
      return `Running ${
        typeof (event.payload as Record<string, unknown>).toolName === 'string'
          ? String((event.payload as Record<string, unknown>).toolName)
          : 'tool'
      }`
    case 'tool_execution_end':
      return 'Idle'
    case 'turn_end':
    case 'agent_end':
      return 'Idle'
    default:
      return current
  }
}

function toAgentRole(value: string): AgentRole {
  switch (value) {
    case 'user':
    case 'assistant':
    case 'tool':
    case 'system':
      return value
    default:
      return 'assistant'
  }
}

export function reduceCodingEnvelope(
  state: CodingUiState,
  envelope: StreamEnvelope<SandboxDaemonEvent>,
): CodingUiState {
  const { event, cursor } = envelope

  if (event.source === 'daemon' && event.type === 'reset') {
    return { ...initialCodingUiState }
  }

  if (event.source === 'daemon' && event.type === 'clear_activities') {
    return { ...state, activities: [] }
  }

  const next: CodingUiState = { ...state, cursor, lastEventType: event.type }

  const agentEvent = coerceAgentEvent(event)
  if (!agentEvent) {
    return next
  }

  const payload = agentEvent.payload
  const t = payload.type

  const activities = updateActivityFromEvent(next.activities, agentEvent)

  let messages = next.messages

  if (t === 'message_start' || t === 'message_update' || t === 'message_end') {
    const message = (payload as Record<string, unknown>).message
    const { role, text, thinking, toolCalls, timestamp } = extractMessageParts(
      message,
    )

    let status: UiMessage['status'] = 'streaming'
    if (t === 'message_end') status = 'complete'

    const messageRecord = isRecord(message) ? message : {}
    const sig = (typeof messageRecord.textSignature === 'string'
      ? messageRecord.textSignature
      : typeof messageRecord.thinkingSignature === 'string'
      ? messageRecord.thinkingSignature
      : '') ||
      `${role}-${timestamp ?? ''}`
    const id = sig || `msg-${cursor}`

    const toolName = typeof messageRecord.toolName === 'string'
      ? messageRecord.toolName
      : undefined

    const base: UiMessage = {
      id,
      role: role === 'toolResult' ? 'tool' : toAgentRole(role),
      title: role === 'user'
        ? 'You'
        : role === 'assistant'
        ? 'Agent'
        : role === 'toolResult'
        ? toolName || 'Tool result'
        : role,
      text,
      thinking,
      toolCalls,
      status,
      cursor,
      timestamp: formatTimestamp(timestamp),
    }

    messages = upsertMessage(messages, base)
  }

  if (t === 'turn_end') {
    messages = messages.map((m) =>
      m.status === 'streaming' ? { ...m, status: 'complete' } : m
    )
  }

  return {
    ...next,
    activities,
    messages,
    agentStatus: nextAgentStatus(next.agentStatus, agentEvent),
  }
}

export function reduceCodingEnvelopes(
  envelopes: Array<StreamEnvelope<SandboxDaemonEvent>>,
  base: CodingUiState = initialCodingUiState,
): CodingUiState {
  return envelopes.reduce(
    (state, env) => reduceCodingEnvelope(state, env),
    base,
  )
}

export function reduceControlEnvelope(
  state: ControlUiState,
  envelope: StreamEnvelope<SandboxControlEvent>,
): ControlUiState {
  const event = envelope.event
  const next: ControlUiState = {
    ...state,
    cursor: envelope.cursor,
    lastEventType: event?.type,
  }

  const type = typeof event?.type === 'string' ? event.type : 'unknown'
  switch (type) {
    case 'sandbox_ready':
      return { ...next, statusLabel: 'Ready', error: undefined }
    case 'repo_cloned':
      return { ...next, statusLabel: 'Repo cloned', error: undefined }
    case 'repo_clone_error': {
      const error = isRecord(event) && typeof event.error === 'string'
        ? event.error
        : 'Repo clone error'
      return { ...next, statusLabel: 'Repo clone error', error }
    }
    case 'init_complete':
      return { ...next, statusLabel: 'Initialized', error: undefined }
    case 'prompt_queued':
      return (() => {
        const record: Record<string, unknown> = isRecord(event) ? event : {}
        const message = typeof record['message'] === 'string'
          ? record['message']
          : ''
        const timestamp = typeof record['timestamp'] === 'number'
          ? record['timestamp']
          : undefined
        let streamingBehavior: 'steer' | 'followUp' | undefined = undefined
        const rawStreamingBehavior = record['streamingBehavior']
        if (
          rawStreamingBehavior === 'steer' ||
          rawStreamingBehavior === 'followUp'
        ) {
          streamingBehavior = rawStreamingBehavior
        }

        return {
          ...next,
          statusLabel: 'Prompt queued',
          error: undefined,
          prompts: [
            ...next.prompts,
            {
              cursor: envelope.cursor,
              message,
              timestamp,
              streamingBehavior,
            },
          ].filter((p) => p.message).slice(-50),
        }
      })()
    case 'daemon_error': {
      const error = isRecord(event) && typeof event.error === 'string'
        ? event.error
        : 'Daemon error'
      return { ...next, statusLabel: 'Daemon error', error }
    }
    case 'sandbox_terminated':
      return { ...next, statusLabel: 'Terminated', error: undefined }
    default:
      return next
  }
}

export { initialControlUiState }
