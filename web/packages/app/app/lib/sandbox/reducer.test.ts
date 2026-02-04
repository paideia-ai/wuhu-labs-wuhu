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
