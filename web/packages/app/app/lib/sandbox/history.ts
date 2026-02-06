import type { UiMessage } from './types.ts'

export type PersistedSandboxMessage = {
  cursor: number
  role: string
  content: string
  toolName: string | null
  toolCallId: string | null
  turnIndex: number
}

function toUiRole(role: string): UiMessage['role'] {
  switch (role) {
    case 'user':
    case 'assistant':
    case 'tool':
    case 'system':
      return role
    default:
      return 'assistant'
  }
}

export function persistedMessagesToUiMessages(
  messages: PersistedSandboxMessage[],
): UiMessage[] {
  const ordered = [...messages].sort((a, b) => a.cursor - b.cursor)
  let agenticTurnIndex = 0

  return ordered.map((message) => {
    const role = toUiRole(message.role)
    if (role === 'user') {
      agenticTurnIndex += 1
    } else if (agenticTurnIndex === 0) {
      agenticTurnIndex = 1
    }

    const title = role === 'user'
      ? 'You'
      : role === 'assistant'
      ? 'Agent'
      : role === 'tool'
      ? (message.toolName ?? 'Tool')
      : message.role

    const id = message.toolCallId
      ? `db-tool-${message.toolCallId}`
      : `db-msg-${message.cursor}`

    return {
      id,
      role,
      title,
      text: message.content,
      status: 'complete',
      cursor: message.cursor,
      turnIndex: agenticTurnIndex,
    }
  })
}
