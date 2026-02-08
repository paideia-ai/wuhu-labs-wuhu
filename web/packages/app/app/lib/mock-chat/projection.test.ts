import { assertEquals } from '@std/assert'
import type {
  AgentBlockEntry,
  CustomEntry,
  HistoryEntry,
  SessionSnapshot,
  UserMessageEntry,
} from './types.ts'
import {
  type AgentBlockView,
  projectMockChat,
  type PromptKind,
  type TurnView,
} from './projection.ts'

function user(
  id: string,
  text: string,
  timestamp: number,
): UserMessageEntry {
  return { type: 'user-message', id, text, timestamp }
}

function custom(
  id: string,
  customType: CustomEntry['customType'],
  timestamp: number,
): CustomEntry {
  return { type: 'custom', id, customType, content: '', timestamp }
}

function block(
  id: string,
  startedAt: number,
  endedAt: number | null,
  items: AgentBlockEntry['items'] = [],
): AgentBlockEntry {
  return { type: 'agent-block', id, startedAt, endedAt, items }
}

function snapshot(history: HistoryEntry[]): SessionSnapshot {
  return {
    history,
    streamingMessage: null,
    isGenerating: false,
    queueMode: 'followUp',
    steerQueue: [],
    followUpQueue: [],
  }
}

function pk(turn: TurnView): PromptKind {
  return turn.prompt.kind
}

function blocks(turn: TurnView): AgentBlockView[] {
  return turn.blocks
}

Deno.test('projectMockChat builds a single completed turn', () => {
  const history: HistoryEntry[] = [
    user('u1', 'run tests', 1_000),
    custom('s1', 'agent-start', 1_100),
    block('b1', 1_100, 5_000, [
      {
        type: 'assistant-message',
        id: 'a1',
        content: 'ok, running tests',
        timestamp: 2_000,
      },
    ]),
    custom('e1', 'agent-end', 5_000),
  ]

  const projection = projectMockChat(snapshot(history))

  assertEquals(projection.turns.length, 1)
  const turn = projection.turns[0]!
  assertEquals(turn.startedAt, 1_000)
  assertEquals(turn.endedAt, 5_000)
  assertEquals(pk(turn), 'fresh')
  assertEquals(blocks(turn).length, 1)
  assertEquals(blocks(turn)[0]!.endReason, 'completed')
  assertEquals(blocks(turn)[0]!.isLastBlockInTurn, true)
  assertEquals(blocks(turn)[0]!.finalAssistantMessageId, 'a1')
})

Deno.test('projectMockChat builds multiple turns with follow-ups', () => {
  const history: HistoryEntry[] = [
    user('u1', 'first', 1_000),
    custom('s1', 'agent-start', 1_100),
    block('b1', 1_100, 2_000, [
      {
        type: 'assistant-message',
        id: 'a1',
        content: 'first reply',
        timestamp: 1_500,
      },
    ]),
    custom('e1', 'agent-end', 2_000),
    user('u2', 'follow-up', 3_000),
    custom('s2', 'agent-start', 3_100),
    block('b2', 3_100, 4_000, [
      {
        type: 'assistant-message',
        id: 'a2',
        content: 'second reply',
        timestamp: 3_500,
      },
    ]),
    custom('e2', 'agent-end', 4_000),
  ]

  const projection = projectMockChat(snapshot(history))

  assertEquals(projection.turns.length, 2)
  const [t1, t2] = projection.turns

  assertEquals(pk(t1!), 'fresh')
  assertEquals(pk(t2!), 'followUp')
  assertEquals(blocks(t1!).length, 1)
  assertEquals(blocks(t2!).length, 1)
  assertEquals(blocks(t2!)[0]!.endReason, 'completed')
})

Deno.test('projectMockChat marks interrupted turns', () => {
  const history: HistoryEntry[] = [
    user('u1', 'do something', 1_000),
    custom('s1', 'agent-start', 1_100),
    block('b1', 1_100, 2_000),
    custom('i1', 'interruption', 2_500),
  ]

  const projection = projectMockChat(snapshot(history))

  assertEquals(projection.turns.length, 1)
  const turn = projection.turns[0]!
  assertEquals(turn.endedAt, 2_500)
  assertEquals(blocks(turn)[0]!.endReason, 'interrupted')
})

Deno.test('projectMockChat keeps steers inside the same turn', () => {
  const history: HistoryEntry[] = [
    user('u1', 'plan work', 1_000),
    custom('s1', 'agent-start', 1_100),
    block('b1', 1_100, 2_000, [
      {
        type: 'tool-call',
        id: 'tc1',
        toolName: 'bash',
        args: { command: 'ls' },
        timestamp: 1_500,
      },
      {
        type: 'tool-result',
        id: 'tr1',
        toolCallId: 'tc1',
        toolName: 'bash',
        isError: false,
        timestamp: 1_600,
      },
    ]),
    // steer message arrives while agent is still working
    user('u-steer', 'actually, focus on tests', 2_100),
    block('b2', 2_200, 3_000, [
      {
        type: 'assistant-message',
        id: 'a2',
        content: 'refocusing',
        timestamp: 2_500,
      },
    ]),
    custom('e1', 'agent-end', 3_000),
  ]

  const projection = projectMockChat(snapshot(history))

  assertEquals(projection.turns.length, 1)
  const turn = projection.turns[0]!
  assertEquals(pk(turn), 'steer')
  assertEquals(blocks(turn).length, 2)
  const [b1, b2] = blocks(turn)

  // First block was effectively cut by steer
  assertEquals(b1!.endReason, 'steered')
  // Second block completed the turn
  assertEquals(b2!.endReason, 'completed')
  assertEquals(b2!.isLastBlockInTurn, true)
  assertEquals(b2!.finalAssistantMessageId, 'a2')
})

Deno.test('projectMockChat sets activeTurn when last turn has no end', () => {
  const history: HistoryEntry[] = [
    user('u1', 'first', 1_000),
    custom('s1', 'agent-start', 1_100),
    block('b1', 1_100, 2_000),
    custom('e1', 'agent-end', 2_000),
    user('u2', 'second', 3_000),
    custom('s2', 'agent-start', 3_100),
    block('b2', 3_100, null),
  ]

  const projection = projectMockChat(snapshot(history))

  assertEquals(projection.turns.length, 2)
  assertEquals(projection.activeTurn?.prompt.id, 'u2')
})
