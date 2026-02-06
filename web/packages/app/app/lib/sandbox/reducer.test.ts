import { assert, assertEquals } from '@std/assert'

import type { SandboxDaemonEvent, StreamEnvelope } from './types.ts'
import { initialCodingUiState } from './types.ts'
import { reduceCodingEnvelope, reduceCodingEnvelopes } from './reducer.ts'

function parseFixture(): Array<StreamEnvelope<SandboxDaemonEvent>> {
  const url = new URL('./fixtures/sample-stream.sse', import.meta.url)
  const raw = Deno.readTextFileSync(url)
  const blocks = raw.split(/\r?\n\r?\n/)

  const envelopes: Array<StreamEnvelope<SandboxDaemonEvent>> = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const dataLines: string[] = []
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      dataLines.push(line.slice('data:'.length).trimStart())
    }
    if (!dataLines.length) continue
    const json = dataLines.join('\n')
    try {
      const env = JSON.parse(json) as StreamEnvelope<SandboxDaemonEvent>
      if (typeof env.cursor === 'number' && env.event) {
        envelopes.push(env)
      }
    } catch {
      // ignore malformed lines
    }
  }
  return envelopes
}

Deno.test('reduceCodingEnvelopes produces chronological messages', () => {
  const envelopes = parseFixture()
  const state = reduceCodingEnvelopes(envelopes)

  assert(state.messages.every((m) => m.status !== 'streaming'))

  const userIndex = state.messages.findIndex((m) =>
    m.role === 'user' && m.text.includes('pwd')
  )
  const assistantIndex = state.messages.findIndex((m) =>
    m.role === 'assistant' && m.text.includes('Working directory')
  )

  assert(userIndex >= 0)
  assert(assistantIndex > userIndex)
})

Deno.test('reduceCodingEnvelopes does not duplicate tool results', () => {
  const envelopes = parseFixture()
  const state = reduceCodingEnvelopes(envelopes)
  const toolMessages = state.messages.filter((m) => m.role === 'tool')
  const ids = toolMessages.map((m) => m.id)
  const uniqueIds = new Set(ids)
  assertEquals(uniqueIds.size, ids.length)
})

Deno.test('reduceCodingEnvelope supports daemon reset', () => {
  const envelopes = parseFixture()
  const base = reduceCodingEnvelopes(envelopes)
  assert(base.messages.length > 0)

  const reset = reduceCodingEnvelope(base, {
    cursor: 0,
    event: { source: 'daemon', type: 'reset' },
  })

  assertEquals(reset, initialCodingUiState)
})

Deno.test('reduceCodingEnvelope supports clear_activities', () => {
  const envelopes = parseFixture()
  const base = reduceCodingEnvelopes(envelopes)
  const next = reduceCodingEnvelope(base, {
    cursor: base.cursor,
    event: { source: 'daemon', type: 'clear_activities' },
  })

  assertEquals(next.messages, base.messages)
  assertEquals(next.activities, [])
  assertEquals(next.cursor, base.cursor)
  assertEquals(next.lastEventType, base.lastEventType)
})

Deno.test('reduceCodingEnvelope appends protocol-0 text deltas', () => {
  const state0 = initialCodingUiState
  const state1 = reduceCodingEnvelope(state0, {
    cursor: 1,
    event: {
      source: 'agent',
      type: 'message_update',
      payload: { type: 'message_update', text: 'hi ' },
    },
  })
  const state2 = reduceCodingEnvelope(state1, {
    cursor: 2,
    event: {
      source: 'agent',
      type: 'message_update',
      payload: { type: 'message_update', text: 'there' },
    },
  })
  const state3 = reduceCodingEnvelope(state2, {
    cursor: 3,
    event: { source: 'agent', type: 'turn_end', payload: { type: 'turn_end' } },
  })

  assertEquals(state3.messages.length, 1)
  assertEquals(state3.messages[0].role, 'assistant')
  assertEquals(state3.messages[0].text, 'hi there')
  assertEquals(state3.messages[0].status, 'complete')
})

Deno.test('reduceCodingEnvelope reads message.text when content missing', () => {
  const state = reduceCodingEnvelope(initialCodingUiState, {
    cursor: 1,
    event: {
      source: 'agent',
      type: 'message_end',
      payload: {
        type: 'message_end',
        message: { role: 'assistant', text: 'hello', timestamp: 123 },
      },
    },
  })

  assertEquals(state.messages.length, 1)
  assertEquals(state.messages[0].text, 'hello')
  assertEquals(state.messages[0].status, 'complete')
})

Deno.test('reduceCodingEnvelope tracks turn lifecycle and trace metadata', () => {
  const state1 = reduceCodingEnvelope(initialCodingUiState, {
    cursor: 1,
    event: {
      source: 'agent',
      type: 'turn_start',
      payload: { type: 'turn_start', timestamp: 1_000 },
    },
  })
  const state2 = reduceCodingEnvelope(state1, {
    cursor: 2,
    event: {
      source: 'agent',
      type: 'message_end',
      payload: {
        type: 'message_end',
        message: { role: 'user', text: 'build ui', timestamp: 1_100 },
      },
    },
  })
  const state3 = reduceCodingEnvelope(state2, {
    cursor: 3,
    event: {
      source: 'agent',
      type: 'tool_execution_start',
      payload: {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        timestamp: 1_200,
      },
    },
  })
  const state4 = reduceCodingEnvelope(state3, {
    cursor: 4,
    event: {
      source: 'agent',
      type: 'tool_execution_end',
      payload: {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        timestamp: 1_800,
      },
    },
  })
  const state5 = reduceCodingEnvelope(state4, {
    cursor: 5,
    event: {
      source: 'agent',
      type: 'message_end',
      payload: {
        type: 'message_end',
        message: { role: 'assistant', text: 'done', timestamp: 1_900 },
      },
    },
  })
  const state6 = reduceCodingEnvelope(state5, {
    cursor: 6,
    event: {
      source: 'agent',
      type: 'turn_end',
      payload: { type: 'turn_end', timestamp: 2_000 },
    },
  })

  assertEquals(state6.turns.length, 1)
  assertEquals(state6.turns[0]?.status, 'completed')
  assertEquals(state6.turns[0]?.startedAtMs, 1_000)
  assertEquals(state6.turns[0]?.endedAtMs, 2_000)
  assertEquals(state6.turns[0]?.toolCalls.length, 1)
  assertEquals(state6.turns[0]?.toolCalls[0]?.status, 'done')
  assertEquals(
    state6.turns[0]?.timeline.filter((i) => i.kind === 'message').length,
    2,
  )
  assertEquals(
    state6.turns[0]?.finalAssistantMessageId,
    state6.messages.find((m) => m.role === 'assistant' && m.turnIndex === 1)
      ?.id,
  )
  assertEquals(state6.activeTurnIndex, null)
})
