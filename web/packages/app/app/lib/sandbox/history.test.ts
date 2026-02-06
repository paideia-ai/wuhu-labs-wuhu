import { assertEquals } from '@std/assert'

import {
  persistedMessagesToUiMessages,
  type PersistedSandboxMessage,
} from './history.ts'

Deno.test('persistedMessagesToUiMessages normalizes tool-use subturns into one agentic turn', () => {
  const messages: PersistedSandboxMessage[] = [
    {
      cursor: 1,
      role: 'user',
      content: 'what is this repo?',
      toolName: null,
      toolCallId: null,
      turnIndex: 1,
    },
    {
      cursor: 2,
      role: 'assistant',
      content: '',
      toolName: null,
      toolCallId: null,
      turnIndex: 1,
    },
    {
      cursor: 3,
      role: 'tool',
      content: '/root/repo',
      toolName: 'bash',
      toolCallId: 'tool-1',
      turnIndex: 1,
    },
    {
      cursor: 4,
      role: 'assistant',
      content: '',
      toolName: null,
      toolCallId: null,
      turnIndex: 2,
    },
    {
      cursor: 5,
      role: 'tool',
      content: 'README.md',
      toolName: 'bash',
      toolCallId: 'tool-2',
      turnIndex: 2,
    },
    {
      cursor: 6,
      role: 'assistant',
      content: 'Wuhu is a data layer + API for understanding coding agents.',
      toolName: null,
      toolCallId: null,
      turnIndex: 3,
    },
    {
      cursor: 7,
      role: 'user',
      content: 'what is deployed?',
      toolName: null,
      toolCallId: null,
      turnIndex: 4,
    },
    {
      cursor: 8,
      role: 'assistant',
      content: 'Web UI and API are deployed.',
      toolName: null,
      toolCallId: null,
      turnIndex: 4,
    },
  ]

  const uiMessages = persistedMessagesToUiMessages(messages)
  assertEquals(
    uiMessages.map((message) => message.turnIndex),
    [1, 1, 1, 1, 1, 1, 2, 2],
  )
})
