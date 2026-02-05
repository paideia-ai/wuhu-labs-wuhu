import { queuedPromptIsRecordedInCoding } from './dedup.ts'
import type {
  CodingUiState,
  ControlUiState,
  TurnTrace,
  TurnTraceItem,
  UiMessage,
} from './types.ts'

export interface PendingPromptDraft {
  id: string
  message: string
  timestampMs: number
  streamingBehavior: 'steer' | 'followUp'
}

export interface QueuePromptView {
  id: string
  message: string
  timestampMs?: number
  streamingBehavior: 'steer' | 'followUp'
  status: 'queued' | 'sending'
}

export interface TurnView {
  turnIndex: number
  userMessage: UiMessage | null
  assistantMessage: UiMessage | null
  traceItems: TurnTraceItem[]
  toolCallCount: number
  workedForLabel: string | null
  startedAtMs?: number
  endedAtMs?: number
  isRunning: boolean
}

export interface AgentChatProjection {
  completedTurns: TurnView[]
  activeTurn: TurnView | null
  queuePrompts: QueuePromptView[]
}

function formatDurationCompact(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

export function formatWorkedForLabel(options: {
  startedAtMs?: number
  endedAtMs?: number
  nowMs: number
  toolCallCount: number
  active: boolean
}): string | null {
  const { startedAtMs, endedAtMs, nowMs, toolCallCount, active } = options
  if (typeof startedAtMs !== 'number') return null
  const endMs = typeof endedAtMs === 'number' ? endedAtMs : nowMs
  if (!Number.isFinite(endMs) || !Number.isFinite(startedAtMs)) return null
  const elapsed = Math.max(0, endMs - startedAtMs)
  const duration = formatDurationCompact(elapsed)
  if (active) return `Working for ${duration}`
  const calls = toolCallCount === 1
    ? '1 tool call'
    : `${toolCallCount} tool calls`
  return `Worked for ${duration} with ${calls}`
}

function sortMessages(messages: UiMessage[]): UiMessage[] {
  return [...messages].sort((a, b) => {
    const aCursor = typeof a.cursor === 'number'
      ? a.cursor
      : Number.MAX_SAFE_INTEGER
    const bCursor = typeof b.cursor === 'number'
      ? b.cursor
      : Number.MAX_SAFE_INTEGER
    if (aCursor !== bCursor) return aCursor - bCursor
    return a.id.localeCompare(b.id)
  })
}

function pickUserMessage(messages: UiMessage[]): UiMessage | null {
  const users = messages.filter((m) => m.role === 'user')
  if (!users.length) return null
  return users[users.length - 1] ?? null
}

function pickFinalAssistantMessage(messages: UiMessage[]): UiMessage | null {
  const assistants = messages.filter((m) =>
    m.role === 'assistant' && m.status === 'complete'
  )
  if (!assistants.length) return null
  return assistants[assistants.length - 1] ?? null
}

function pickTimeBounds(trace: TurnTrace | undefined, messages: UiMessage[]): {
  startedAtMs?: number
  endedAtMs?: number
} {
  const messageTimes = messages
    .map((message) => message.timestampMs)
    .filter((value): value is number => typeof value === 'number')
  const messageStart = messageTimes.length
    ? Math.min(...messageTimes)
    : undefined
  const messageEnd = messageTimes.length ? Math.max(...messageTimes) : undefined

  return {
    startedAtMs: trace?.startedAtMs ?? messageStart,
    endedAtMs: trace?.endedAtMs ?? messageEnd,
  }
}

export function projectAgentChatState(options: {
  coding: CodingUiState
  control: ControlUiState
  pendingPrompts: PendingPromptDraft[]
  nowMs: number
}): AgentChatProjection {
  const { coding, control, pendingPrompts, nowMs } = options

  const turnMessages = new Map<number, UiMessage[]>()
  for (const message of sortMessages(coding.messages)) {
    if (typeof message.turnIndex !== 'number') continue
    const bucket = turnMessages.get(message.turnIndex) ?? []
    bucket.push(message)
    turnMessages.set(message.turnIndex, bucket)
  }

  const turnMap = new Map<number, TurnTrace>()
  for (const turn of coding.turns) {
    turnMap.set(turn.turnIndex, turn)
  }

  const allTurnIndices = new Set<number>()
  for (const index of turnMap.keys()) allTurnIndices.add(index)
  for (const index of turnMessages.keys()) allTurnIndices.add(index)

  const sortedTurnIndices = [...allTurnIndices].sort((a, b) => a - b)
  const views: TurnView[] = sortedTurnIndices.map((turnIndex) => {
    const trace = turnMap.get(turnIndex)
    const messages = turnMessages.get(turnIndex) ?? []
    const isRunning = trace?.status === 'running' ||
      coding.activeTurnIndex === turnIndex
    const userMessage = pickUserMessage(messages)
    const assistantMessage = isRunning
      ? null
      : pickFinalAssistantMessage(messages)
    const bounds = pickTimeBounds(trace, messages)
    const workedForLabel = formatWorkedForLabel({
      startedAtMs: bounds.startedAtMs,
      endedAtMs: bounds.endedAtMs,
      nowMs,
      toolCallCount: trace?.toolCalls.length ?? 0,
      active: isRunning,
    })

    return {
      turnIndex,
      userMessage,
      assistantMessage,
      traceItems: trace?.timeline ?? [],
      toolCallCount: trace?.toolCalls.length ?? 0,
      workedForLabel,
      startedAtMs: bounds.startedAtMs,
      endedAtMs: bounds.endedAtMs,
      isRunning,
    }
  })

  const activeTurn = views.find((turn) => turn.isRunning) ?? null
  const completedTurns = views.filter((turn) => !turn.isRunning)

  const queuedFromControl: QueuePromptView[] = control.prompts
    .filter((prompt) =>
      !queuedPromptIsRecordedInCoding(prompt, coding.messages)
    )
    .map((prompt) => ({
      id: `queued-${prompt.cursor}`,
      message: prompt.message,
      timestampMs: prompt.timestamp,
      streamingBehavior: prompt.streamingBehavior ?? 'followUp',
      status: 'queued' as const,
    }))

  const queuedLocal: QueuePromptView[] = pendingPrompts.map((prompt) => ({
    id: prompt.id,
    message: prompt.message,
    timestampMs: prompt.timestampMs,
    streamingBehavior: prompt.streamingBehavior,
    status: 'sending',
  }))

  const queuePrompts = [...queuedFromControl, ...queuedLocal]
    .filter((prompt) => prompt.message.trim().length > 0)
    .sort((a, b) => {
      const aTs = a.timestampMs ?? 0
      const bTs = b.timestampMs ?? 0
      if (aTs !== bTs) return aTs - bTs
      return a.id.localeCompare(b.id)
    })

  return {
    completedTurns,
    activeTurn,
    queuePrompts,
  }
}
