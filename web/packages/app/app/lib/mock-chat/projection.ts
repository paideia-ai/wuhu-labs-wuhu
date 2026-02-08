import type {
  AgentBlockEntry,
  AgentBlockItem,
  CustomEntry,
  HistoryEntry,
  SessionSnapshot,
  UserMessageEntry,
} from './types.ts'
import { groupAgentBlockItems, type RenderBlock } from './tool-grouping.ts'

export type PromptKind = 'fresh' | 'followUp' | 'steer'

export type BlockEndReason =
  | 'completed'
  | 'interrupted'
  | 'steered'
  | 'followUpStart'

export interface AgentBlockView {
  id: string
  startedAt: number
  endedAt: number | null
  endReason: BlockEndReason | null
  renderBlocks: RenderBlock[]
  finalAssistantMessageId: string | null
  isLastBlockInTurn: boolean
}

export interface TurnView {
  id: string
  startedAt: number
  endedAt: number | null
  prompt: {
    id: string
    text: string
    kind: PromptKind
  }
  blocks: AgentBlockView[]
}

export interface MockChatProjection {
  turns: TurnView[]
  activeTurn: TurnView | null
}

function lastAgentBlock(history: HistoryEntry[]): AgentBlockEntry | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.type === 'agent-block') {
      return entry
    }
  }
  return null
}

function classifyPromptKind(
  history: HistoryEntry[],
  index: number,
): PromptKind {
  // No previous entries → fresh prompt.
  if (index === 0) return 'fresh'

  // Walk backwards to find the previous *message-like* thing.
  for (let i = index - 1; i >= 0; i--) {
    const entry = history[i]

    if (entry.type === 'user-message') {
      // Two user messages in a row – treat later one as follow-up.
      return 'followUp'
    }

    if (entry.type === 'agent-block') {
      const items = entry.items
      const last = items[items.length - 1]
      if (!last) {
        // Empty block – default to follow-up.
        return 'followUp'
      }
      if (last.type === 'assistant-message') {
        return 'followUp'
      }
      // Tool calls / results / reasoning inside an active tool phase → steer.
      return 'steer'
    }

    // Skip custom entries (agent-start/end, interruption) for classification.
  }

  return 'fresh'
}

function buildAgentBlockView(
  entry: AgentBlockEntry,
  endReason: BlockEndReason | null,
): AgentBlockView {
  const renderBlocks = groupAgentBlockItems(entry.items)

  let finalAssistantMessageId: string | null = null
  for (let i = entry.items.length - 1; i >= 0; i--) {
    const item: AgentBlockItem = entry.items[i]!
    if (item.type === 'assistant-message') {
      finalAssistantMessageId = item.id
      break
    }
  }

  return {
    id: entry.id,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    endReason,
    renderBlocks,
    finalAssistantMessageId,
    isLastBlockInTurn: false, // filled in at the end
  }
}

/**
 * Project raw session snapshot history into a higher-level view model of
 * turns and agent blocks. This transformation is pure and does not mutate
 * the input snapshot.
 */
export function projectMockChat(
  snapshot: SessionSnapshot,
): MockChatProjection {
  const { history } = snapshot

  const turns: TurnView[] = []
  let currentTurn: TurnView | null = null

  function ensureTurnForUserMessage(
    entry: UserMessageEntry,
    index: number,
  ): void {
    const kind = classifyPromptKind(history, index)

    if (!currentTurn) {
      currentTurn = {
        id: entry.id,
        startedAt: entry.timestamp,
        endedAt: null,
        prompt: {
          id: entry.id,
          text: entry.text,
          kind,
        },
        blocks: [],
      }
      turns.push(currentTurn)
      return
    }

    if (kind === 'followUp') {
      // Follow-up starts a new turn only if the previous one has completed.
      if (currentTurn.endedAt !== null) {
        currentTurn = {
          id: entry.id,
          startedAt: entry.timestamp,
          endedAt: null,
          prompt: {
            id: entry.id,
            text: entry.text,
            kind,
          },
          blocks: [],
        }
        turns.push(currentTurn)
        return
      }
      // If the current turn is still running, treat this as a steer inside
      // the same turn.
      currentTurn.prompt = {
        id: entry.id,
        text: entry.text,
        kind: 'steer',
      }
      return
    }

    if (kind === 'steer') {
      // Steers never start a new turn – they update the current turn's prompt
      // metadata to indicate steering.
      currentTurn.prompt = {
        id: entry.id,
        text: entry.text,
        kind: 'steer',
      }
      return
    }

    // Fallback: treat as fresh if there is no active turn.
    if (currentTurn.endedAt !== null) {
      currentTurn = {
        id: entry.id,
        startedAt: entry.timestamp,
        endedAt: null,
        prompt: {
          id: entry.id,
          text: entry.text,
          kind: 'fresh',
        },
        blocks: [],
      }
      turns.push(currentTurn)
    }
  }

  function attachAgentBlock(entry: AgentBlockEntry): void {
    if (!currentTurn) {
      // If for some reason we see a block without a user prompt, synthesise
      // a dummy fresh turn.
      currentTurn = {
        id: entry.id,
        startedAt: entry.startedAt,
        endedAt: null,
        prompt: {
          id: entry.id,
          text: '',
          kind: 'fresh',
        },
        blocks: [],
      }
      turns.push(currentTurn)
    }

    const blockView = buildAgentBlockView(entry, null)
    currentTurn.blocks.push(blockView)
  }

  function markTurnCompleted(at: number): void {
    if (!currentTurn) return
    currentTurn.endedAt = at
    const blocks = currentTurn.blocks
    if (blocks.length > 0) {
      const last = blocks[blocks.length - 1]!
      if (last.endReason === null) {
        last.endReason = 'completed'
      }
    }
  }

  function markTurnInterrupted(at: number): void {
    if (!currentTurn) return
    currentTurn.endedAt = at
    const blocks = currentTurn.blocks
    if (blocks.length > 0) {
      const last = blocks[blocks.length - 1]!
      if (last.endReason === null) {
        last.endReason = 'interrupted'
      }
    }
  }

  // First pass: build turns and blocks with end reasons at turn level.
  for (let index = 0; index < history.length; index++) {
    const entry = history[index]!

    switch (entry.type) {
      case 'user-message':
        ensureTurnForUserMessage(entry, index)
        break

      case 'agent-block':
        attachAgentBlock(entry)
        break

      case 'custom':
        if (entry.customType === 'interruption') {
          markTurnInterrupted(entry.timestamp)
        }
        if (entry.customType === 'agent-end') {
          markTurnCompleted(entry.timestamp)
        }
        break
    }
  }

  // Second pass: mark blocks that ended because of steers.
  // Heuristic: if we see steer user messages while a turn is running and
  // there is a completed agent block immediately before them, treat that
  // block as 'steered'.
  for (const turn of turns) {
    for (let i = 0; i < history.length; i++) {
      const entry = history[i]!
      if (entry.type !== 'user-message') continue
      const kind = classifyPromptKind(history, i)
      if (kind !== 'steer') continue

      const prevBlock = lastAgentBlock(history.slice(0, i))
      if (!prevBlock) continue

      const target = turn.blocks.find((b) => b.id === prevBlock.id)
      if (!target) continue

      if (target.endReason === null) {
        target.endReason = 'steered'
      }
    }
  }

  // Final pass: set isLastBlockInTurn flags.
  for (const turn of turns) {
    if (turn.blocks.length > 0) {
      turn.blocks[turn.blocks.length - 1]!.isLastBlockInTurn = true
    }
  }

  const activeTurn = turns.length > 0
    ? (turns[turns.length - 1]!.endedAt === null
      ? turns[turns.length - 1]!
      : null)
    : null

  return { turns, activeTurn }
}
