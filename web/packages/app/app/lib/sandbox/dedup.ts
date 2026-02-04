import type { UiMessage } from './types.ts'

export interface QueuedPrompt {
  cursor: number
  message: string
}

export function queuedPromptIsRecordedInCoding(
  prompt: QueuedPrompt,
  codingMessages: UiMessage[],
): boolean {
  // Note: We only check for text match, not cursor comparison, because
  // control stream cursors and coding stream cursors are independent sequences.
  // A queued prompt should be hidden once any matching user message appears
  // in the coding stream, regardless of cursor values.
  return codingMessages.some((m) =>
    m.role === 'user' &&
    m.text === prompt.message
  )
}
