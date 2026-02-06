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

  const directText = record.text
  if (typeof directText === 'string') {
    parts.text = directText
  }
  const directThinking = record.thinking
  if (typeof directThinking === 'string') {
    parts.thinking = directThinking
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

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i
  }
  return -1
}

function coerceStreamingTextDelta(payload: Record<string, unknown>): string {
  const text = payload.text
  if (typeof text === 'string') return text
  const delta = payload.delta
  if (typeof delta === 'string') return delta
  return ''
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
  const payload = event.payload as Record<string, unknown>
  const t = payload.type
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
      if (!isAgenticTurnTerminal(payload)) return 'Responding'
      return 'Idle'
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

function readTimestampMs(event: SandboxDaemonAgentEvent): number | undefined {
  const payload = event.payload as Record<string, unknown>
  const payloadTs = payload.timestamp
  if (typeof payloadTs === 'number' && Number.isFinite(payloadTs)) {
    return payloadTs
  }
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) {
    return event.timestamp
  }
  return undefined
}

function readTurnEndStopReason(
  payload: Record<string, unknown>,
): string | null {
  const directStopReason = payload.stopReason
  if (
    typeof directStopReason === 'string' &&
    directStopReason.trim().length > 0
  ) {
    return directStopReason
  }

  const message = payload.message
  if (!isRecord(message)) return null
  const messageStopReason = message.stopReason
  if (
    typeof messageStopReason === 'string' &&
    messageStopReason.trim().length > 0
  ) {
    return messageStopReason
  }

  return null
}

function turnEndHasPendingToolCalls(payload: Record<string, unknown>): boolean {
  const message = payload.message
  if (!isRecord(message)) return false
  return extractMessageParts(message).toolCalls.length > 0
}

function isAgenticTurnTerminal(payload: Record<string, unknown>): boolean {
  const stopReason = readTurnEndStopReason(payload)
  if (stopReason === 'toolUse' || stopReason === 'tool_use') {
    return false
  }
  if (turnEndHasPendingToolCalls(payload)) return false
  return true
}

function withTurn(
  state: CodingUiState,
  timestampMs?: number,
): CodingUiState {
  if (
    typeof state.activeTurnIndex === 'number' &&
    state.turns.some((t) => t.turnIndex === state.activeTurnIndex)
  ) {
    return state
  }

  const turnIndex = state.nextTurnIndex + 1
  const nextTurn = {
    turnIndex,
    status: 'running' as const,
    startedAtMs: timestampMs,
    endedAtMs: undefined,
    userMessageId: undefined,
    finalAssistantMessageId: undefined,
    toolCalls: [],
    timeline: [],
  }

  return {
    ...state,
    activeTurnIndex: turnIndex,
    nextTurnIndex: turnIndex,
    turns: [...state.turns, nextTurn],
  }
}

function updateTurnByIndex(
  turns: CodingUiState['turns'],
  turnIndex: number,
  updater: (
    turn: CodingUiState['turns'][number],
  ) => CodingUiState['turns'][number],
): CodingUiState['turns'] {
  const idx = turns.findIndex((t) => t.turnIndex === turnIndex)
  if (idx === -1) return turns
  const next = [...turns]
  next[idx] = updater(next[idx])
  return next
}

function upsertTurnToolCall(
  state: CodingUiState,
  options: {
    toolCallId: string
    toolName: string
    status: 'running' | 'done' | 'error'
    cursor: number
    timestampMs?: number
    addTimelineItem?: boolean
  },
): CodingUiState {
  if (typeof state.activeTurnIndex !== 'number') return state
  const turnIndex = state.activeTurnIndex
  const turns = updateTurnByIndex(state.turns, turnIndex, (turn) => {
    const toolCalls = [...turn.toolCalls]
    const toolIdx = toolCalls.findIndex((call) =>
      call.id === options.toolCallId
    )
    const startedAtMs = toolIdx >= 0
      ? toolCalls[toolIdx].startedAtMs
      : options.timestampMs
    const nextCall = {
      id: options.toolCallId,
      toolName: options.toolName,
      status: options.status,
      cursor: options.cursor,
      startedAtMs,
      endedAtMs: options.status === 'running'
        ? undefined
        : (options.timestampMs ?? toolCalls[toolIdx]?.endedAtMs),
    }
    if (toolIdx === -1) toolCalls.push(nextCall)
    else toolCalls[toolIdx] = { ...toolCalls[toolIdx], ...nextCall }

    const timeline = [...turn.timeline]
    const timelineIdx = timeline.findIndex((item) =>
      item.kind === 'tool' && item.toolCallId === options.toolCallId
    )
    if (timelineIdx === -1 && options.addTimelineItem !== false) {
      timeline.push({
        id: `trace-tool-${options.toolCallId}-${options.cursor}`,
        kind: 'tool',
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        status: options.status,
        cursor: options.cursor,
        timestampMs: options.timestampMs,
      })
    } else if (timelineIdx >= 0) {
      const current = timeline[timelineIdx]
      if (current?.kind === 'tool') {
        timeline[timelineIdx] = {
          ...current,
          toolName: options.toolName,
          status: options.status,
          cursor: options.cursor,
          timestampMs: options.timestampMs ?? current.timestampMs,
        }
      }
    }

    return { ...turn, toolCalls, timeline }
  })
  return turns === state.turns ? state : { ...state, turns }
}

function appendTraceMessageItem(
  state: CodingUiState,
  message: UiMessage,
): CodingUiState {
  const turnIndex = message.turnIndex
  if (typeof turnIndex !== 'number') return state
  const turns = updateTurnByIndex(state.turns, turnIndex, (turn) => {
    const timeline = [...turn.timeline]
    const timelineId = `trace-msg-${message.id}-${message.cursor ?? 0}`
    if (timeline.some((item) => item.id === timelineId)) {
      return turn
    }
    timeline.push({
      id: timelineId,
      kind: 'message',
      role: message.role,
      messageId: message.id,
      text: message.text,
      cursor: message.cursor ?? 0,
      timestampMs: message.timestampMs,
    })
    const userMessageId = message.role === 'user'
      ? message.id
      : turn.userMessageId
    const finalAssistantMessageId = message.role === 'assistant'
      ? message.id
      : turn.finalAssistantMessageId
    return { ...turn, timeline, userMessageId, finalAssistantMessageId }
  })
  return turns === state.turns ? state : { ...state, turns }
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

  let next: CodingUiState = { ...state, cursor, lastEventType: event.type }

  const agentEvent = coerceAgentEvent(event)
  if (!agentEvent) {
    return next
  }

  const payload = agentEvent.payload
  const t = payload.type
  const timestampMs = readTimestampMs(agentEvent)

  if (t === 'turn_start') {
    next = withTurn(next, timestampMs)
  }

  const activities = updateActivityFromEvent(next.activities, agentEvent)
  next = { ...next, activities }

  const toolCallIdRaw = (payload as Record<string, unknown>).toolCallId
  const toolCallId = typeof toolCallIdRaw === 'string' && toolCallIdRaw.length
    ? toolCallIdRaw
    : ''
  const toolNameRaw = (payload as Record<string, unknown>).toolName
  const toolName = typeof toolNameRaw === 'string' && toolNameRaw.length
    ? toolNameRaw
    : 'tool'

  if (t === 'tool_execution_start') {
    next = withTurn(next, timestampMs)
    next = upsertTurnToolCall(next, {
      toolCallId: toolCallId || `tool-${cursor}`,
      toolName,
      status: 'running',
      cursor,
      timestampMs,
      addTimelineItem: true,
    })
  } else if (t === 'tool_execution_update') {
    next = withTurn(next, timestampMs)
    next = upsertTurnToolCall(next, {
      toolCallId: toolCallId || `tool-${cursor}`,
      toolName,
      status: 'running',
      cursor,
      timestampMs,
      addTimelineItem: false,
    })
  } else if (t === 'tool_execution_end') {
    next = withTurn(next, timestampMs)
    next = upsertTurnToolCall(next, {
      toolCallId: toolCallId || `tool-${cursor}`,
      toolName,
      status: (payload as Record<string, unknown>).isError ? 'error' : 'done',
      cursor,
      timestampMs,
      addTimelineItem: false,
    })
  }

  let messages = next.messages
  let completedMessageForTrace: UiMessage | null = null

  if (t === 'message_start' || t === 'message_update' || t === 'message_end') {
    next = withTurn(next, timestampMs)
    const payloadRecord = payload as Record<string, unknown>
    const message = payloadRecord.message
    const textDelta = !message ? coerceStreamingTextDelta(payloadRecord) : ''

    if (!message && !textDelta && t !== 'message_end') {
      return {
        ...next,
        activities,
        messages,
        agentStatus: nextAgentStatus(next.agentStatus, agentEvent),
      }
    }

    // Protocol-0 style streams may not include a full `message` object, only
    // `text` deltas. In that case, keep a single streaming assistant message and
    // append/replace content as updates arrive.
    if (!message) {
      const role = toAgentRole(
        typeof payloadRecord.role === 'string'
          ? payloadRecord.role
          : 'assistant',
      )
      const isStreaming = t !== 'message_end'
      const existingIdx = findLastIndex(
        messages,
        (m) => m.status === 'streaming' && m.role === role,
      )

      if (existingIdx === -1) {
        if (!textDelta && t === 'message_end') {
          return {
            ...next,
            activities,
            messages,
            agentStatus: nextAgentStatus(next.agentStatus, agentEvent),
          }
        }
        const timestamp = typeof payloadRecord.timestamp === 'number'
          ? payloadRecord.timestamp
          : undefined
        const id = `pi-msg-${cursor}-${role}`
        messages = upsertMessage(messages, {
          id,
          role,
          title: role === 'user'
            ? 'You'
            : role === 'assistant'
            ? 'Agent'
            : role,
          text: textDelta,
          status: isStreaming ? 'streaming' : 'complete',
          cursor,
          timestamp: formatTimestamp(timestamp),
          timestampMs: timestamp,
          turnIndex: next.activeTurnIndex ?? undefined,
        })
        if (!isStreaming) {
          completedMessageForTrace = messages.find((m) => m.id === id) ?? null
        }
      } else {
        const existing = messages[existingIdx]
        const existingText = existing.text ?? ''
        let nextText = existingText
        if (textDelta) {
          if (
            existingText &&
            textDelta.length >= existingText.length &&
            textDelta.startsWith(existingText)
          ) {
            nextText = textDelta
          } else if (existingText && existingText.startsWith(textDelta)) {
            nextText = existingText
          } else {
            nextText = existingText + textDelta
          }
        }
        const updated: UiMessage = {
          ...existing,
          text: nextText,
          status: isStreaming ? 'streaming' : 'complete',
          turnIndex: existing.turnIndex ?? next.activeTurnIndex ?? undefined,
        }
        messages = upsertMessage(messages, updated)
        if (!isStreaming) {
          completedMessageForTrace = messages.find((m) =>
            m.id === updated.id
          ) ?? null
        }
      }
    } else {
      const { role, text, thinking, toolCalls, timestamp } =
        extractMessageParts(
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
        timestampMs: timestamp,
        turnIndex: next.activeTurnIndex ?? undefined,
      }

      messages = upsertMessage(messages, base)
      if (status === 'complete') {
        completedMessageForTrace = messages.find((m) =>
          m.id === base.id
        ) ?? null
      }
    }
  }

  if (t === 'turn_end') {
    const payloadRecord = payload as Record<string, unknown>
    const turnEndMessage = payloadRecord.message
    if (isRecord(turnEndMessage)) {
      const { role, text, thinking, toolCalls, timestamp } =
        extractMessageParts(
          turnEndMessage,
        )
      const messageRecord = turnEndMessage
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
      const fallbackTurnIndex = next.activeTurnIndex ??
        (typeof next.nextTurnIndex === 'number'
          ? next.nextTurnIndex
          : undefined)
      messages = upsertMessage(messages, {
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
        status: 'complete',
        cursor,
        timestamp: formatTimestamp(timestamp),
        timestampMs: timestamp,
        turnIndex: fallbackTurnIndex,
      })
      completedMessageForTrace = messages.find((m) =>
        m.id === id
      ) ?? completedMessageForTrace
    }
  }

  if (t === 'turn_end') {
    messages = messages.map((m) =>
      m.status === 'streaming' ? { ...m, status: 'complete' } : m
    )
  }

  next = { ...next, messages }

  if (
    completedMessageForTrace && completedMessageForTrace.turnIndex !== undefined
  ) {
    next = appendTraceMessageItem(next, completedMessageForTrace)
  }

  if (t === 'turn_end' && typeof next.activeTurnIndex === 'number') {
    const payloadRecord = payload as Record<string, unknown>
    if (isAgenticTurnTerminal(payloadRecord)) {
      const finishingTurnIndex = next.activeTurnIndex
      const finalAssistant = [...messages].reverse().find((message) =>
        message.role === 'assistant' &&
        message.status === 'complete' &&
        message.turnIndex === finishingTurnIndex
      )
      const turns = updateTurnByIndex(next.turns, finishingTurnIndex, (
        turn,
      ) => ({
        ...turn,
        status: 'completed',
        endedAtMs: timestampMs ?? turn.endedAtMs,
        finalAssistantMessageId: finalAssistant?.id ??
          turn.finalAssistantMessageId,
      }))
      next = {
        ...next,
        turns,
        activeTurnIndex: null,
      }
    }
  }

  return {
    ...next,
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
