import { assert, assertEquals } from '@std/assert'
import { queuedPromptIsRecordedInCoding } from './dedup.ts'
import type { UiMessage } from './types.ts'

function msg(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: overrides.id ?? 'm1',
    role: overrides.role ?? 'assistant',
    title: overrides.title ?? 'Agent',
    text: overrides.text ?? '',
    status: overrides.status ?? 'complete',
    cursor: overrides.cursor,
    timestamp: overrides.timestamp,
    thinking: overrides.thinking,
    toolCalls: overrides.toolCalls,
  }
}

Deno.test('queuedPromptIsRecordedInCoding matches user message with same text', () => {
  const recorded = queuedPromptIsRecordedInCoding(
    { cursor: 10, message: 'hello' },
    [msg({ role: 'user', text: 'hello' })],
  )
  assert(recorded)
})

Deno.test('queuedPromptIsRecordedInCoding does not match different text', () => {
  const recorded = queuedPromptIsRecordedInCoding(
    { cursor: 10, message: 'hello' },
    [msg({ role: 'user', text: 'goodbye' })],
  )
  assertEquals(recorded, false)
})

Deno.test('queuedPromptIsRecordedInCoding ignores non-user messages', () => {
  const recorded = queuedPromptIsRecordedInCoding(
    { cursor: 10, message: 'hello' },
    [msg({ role: 'assistant', text: 'hello' })],
  )
  assertEquals(recorded, false)
})

Deno.test('queuedPromptIsRecordedInCoding matches regardless of cursor values', () => {
  // Cursors from control and coding streams are independent sequences,
  // so we should match based on text content only
  const recorded = queuedPromptIsRecordedInCoding(
    { cursor: 100, message: 'hello' },
    [msg({ role: 'user', text: 'hello', cursor: 5 })],
  )
  assert(recorded)
})
