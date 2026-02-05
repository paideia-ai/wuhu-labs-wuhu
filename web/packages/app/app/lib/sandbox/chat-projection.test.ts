import { assertEquals, assertExists } from '@std/assert'
import {
  formatWorkedForLabel,
  type PendingPromptDraft,
  projectAgentChatState,
} from './chat-projection.ts'
import {
  type CodingUiState,
  initialCodingUiState,
  initialControlUiState,
  type UiMessage,
} from './types.ts'

function msg(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: overrides.id ?? 'm',
    role: overrides.role ?? 'assistant',
    title: overrides.title ?? 'Agent',
    text: overrides.text ?? '',
    status: overrides.status ?? 'complete',
    cursor: overrides.cursor,
    timestamp: overrides.timestamp,
    timestampMs: overrides.timestampMs,
    turnIndex: overrides.turnIndex,
    toolCalls: overrides.toolCalls,
    thinking: overrides.thinking,
  }
}

function coding(overrides: Partial<CodingUiState>): CodingUiState {
  return {
    ...initialCodingUiState,
    ...overrides,
  }
}

Deno.test('formatWorkedForLabel formats active and completed durations', () => {
  assertEquals(
    formatWorkedForLabel({
      startedAtMs: 1_000,
      endedAtMs: 65_000,
      nowMs: 70_000,
      toolCallCount: 2,
      active: false,
    }),
    'Worked for 1m 4s with 2 tool calls',
  )

  assertEquals(
    formatWorkedForLabel({
      startedAtMs: 1_000,
      endedAtMs: undefined,
      nowMs: 5_500,
      toolCallCount: 0,
      active: true,
    }),
    'Working for 4s',
  )
})

Deno.test('projectAgentChatState hides assistant output while turn is running', () => {
  const state = coding({
    nextTurnIndex: 2,
    activeTurnIndex: 2,
    messages: [
      msg({
        id: 'u2',
        role: 'user',
        title: 'You',
        text: 'run tests',
        turnIndex: 2,
        status: 'complete',
        cursor: 21,
      }),
      msg({
        id: 'a2',
        role: 'assistant',
        title: 'Agent',
        text: 'intermediate output',
        turnIndex: 2,
        status: 'streaming',
        cursor: 22,
      }),
    ],
    turns: [
      {
        turnIndex: 2,
        status: 'running',
        startedAtMs: 1_000,
        endedAtMs: undefined,
        toolCalls: [],
        timeline: [],
      },
    ],
  })

  const projection = projectAgentChatState({
    coding: state,
    control: initialControlUiState,
    pendingPrompts: [],
    nowMs: 4_000,
  })

  assertExists(projection.activeTurn)
  assertEquals(projection.activeTurn?.assistantMessage, null)
  assertEquals(projection.activeTurn?.workedForLabel, 'Working for 3s')
})

Deno.test('projectAgentChatState shows completed turn with final assistant message', () => {
  const state = coding({
    messages: [
      msg({
        id: 'u1',
        role: 'user',
        title: 'You',
        text: 'what changed?',
        turnIndex: 1,
        status: 'complete',
        cursor: 1,
      }),
      msg({
        id: 'a1-old',
        role: 'assistant',
        title: 'Agent',
        text: 'partial',
        turnIndex: 1,
        status: 'complete',
        cursor: 2,
      }),
      msg({
        id: 'a1-final',
        role: 'assistant',
        title: 'Agent',
        text: 'final answer',
        turnIndex: 1,
        status: 'complete',
        cursor: 3,
      }),
    ],
    turns: [
      {
        turnIndex: 1,
        status: 'completed',
        startedAtMs: 10_000,
        endedAtMs: 80_000,
        toolCalls: [
          {
            id: 'tool-1',
            toolName: 'bash',
            status: 'done',
            cursor: 2,
            startedAtMs: 20_000,
            endedAtMs: 70_000,
          },
        ],
        timeline: [
          {
            id: 'trace-tool-1',
            kind: 'tool',
            toolCallId: 'tool-1',
            toolName: 'bash',
            status: 'done',
            cursor: 2,
            timestampMs: 20_000,
          },
        ],
        finalAssistantMessageId: 'a1-final',
      },
    ],
  })

  const projection = projectAgentChatState({
    coding: state,
    control: initialControlUiState,
    pendingPrompts: [],
    nowMs: 90_000,
  })

  assertEquals(projection.activeTurn, null)
  assertEquals(projection.completedTurns.length, 1)
  assertEquals(projection.completedTurns[0]?.assistantMessage?.id, 'a1-final')
  assertEquals(
    projection.completedTurns[0]?.workedForLabel,
    'Worked for 1m 10s with 1 tool call',
  )
})

Deno.test('projectAgentChatState merges queue prompts and deduplicates recorded prompts', () => {
  const state = coding({
    messages: [
      msg({
        id: 'u-recorded',
        role: 'user',
        title: 'You',
        text: 'already queued',
        status: 'complete',
        cursor: 12,
        turnIndex: 3,
      }),
    ],
  })

  const pending: PendingPromptDraft[] = [
    {
      id: 'local-1',
      message: 'local message',
      timestampMs: 2_000,
      streamingBehavior: 'steer',
    },
  ]

  const projection = projectAgentChatState({
    coding: state,
    control: {
      ...initialControlUiState,
      prompts: [
        {
          cursor: 10,
          message: 'already queued',
          timestamp: 1_000,
          streamingBehavior: 'followUp',
        },
        {
          cursor: 13,
          message: 'new queued',
          timestamp: 3_000,
          streamingBehavior: 'steer',
        },
      ],
    },
    pendingPrompts: pending,
    nowMs: 4_000,
  })

  assertEquals(
    projection.queuePrompts.map((
      item,
    ) => [item.message, item.streamingBehavior, item.status]),
    [
      ['local message', 'steer', 'sending'],
      ['new queued', 'steer', 'queued'],
    ],
  )
})
