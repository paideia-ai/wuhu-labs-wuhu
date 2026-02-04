import { assertEquals } from '@std/assert'
import { persistedMessagesToUiMessages } from './history.ts'

Deno.test('persistedMessagesToUiMessages maps roles + tool metadata', () => {
  const ui = persistedMessagesToUiMessages([
    {
      cursor: 1,
      role: 'user',
      content: 'hello',
      toolName: null,
      toolCallId: null,
      turnIndex: 1,
    },
    {
      cursor: 2,
      role: 'assistant',
      content: 'hi',
      toolName: null,
      toolCallId: null,
      turnIndex: 1,
    },
    {
      cursor: 3,
      role: 'tool',
      content: '{"ok":true}',
      toolName: 'bash',
      toolCallId: 'call_123',
      turnIndex: 1,
    },
    {
      cursor: 4,
      role: 'weird_role',
      content: '???',
      toolName: null,
      toolCallId: null,
      turnIndex: 1,
    },
  ])

  assertEquals(ui.map((m) => [m.role, m.title]), [
    ['user', 'You'],
    ['assistant', 'Agent'],
    ['tool', 'bash'],
    ['assistant', 'Agent'],
  ])
  assertEquals(ui[2]?.id, 'db-tool-call_123')
  assertEquals(ui[2]?.cursor, 3)
  assertEquals(ui[2]?.status, 'complete')
})
