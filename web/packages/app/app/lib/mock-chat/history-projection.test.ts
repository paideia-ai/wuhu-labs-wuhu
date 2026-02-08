import { assertEquals } from '@std/assert'
import type { HistoryEntry } from './types.ts'
import { getDurationLabel } from './history-projection.ts'

function agentStart(id: string, timestamp: number): HistoryEntry {
  return {
    type: 'custom',
    id,
    customType: 'agent-start',
    content: '',
    timestamp,
  }
}

function agentEnd(id: string, timestamp: number): HistoryEntry {
  return {
    type: 'custom',
    id,
    customType: 'agent-end',
    content: '',
    timestamp,
  }
}

function interruption(id: string, timestamp: number): HistoryEntry {
  return {
    type: 'custom',
    id,
    customType: 'interruption',
    content: 'Generation interrupted',
    timestamp,
  }
}

function userMessage(id: string, timestamp: number): HistoryEntry {
  return {
    type: 'user-message',
    id,
    text: 'user',
    timestamp,
  }
}

function agentBlock(
  id: string,
  startedAt: number,
  endedAt: number | null,
): HistoryEntry {
  return {
    type: 'agent-block',
    id,
    items: [],
    startedAt,
    endedAt,
  }
}

Deno.test('getDurationLabel returns null for non-agent-end entries', () => {
  const history: HistoryEntry[] = [
    agentStart('s1', 1_000),
    agentBlock('b1', 1_000, 2_000),
    userMessage('u1', 1_500),
  ]

  assertEquals(getDurationLabel(history, 0), null)
  assertEquals(getDurationLabel(history, 1), null)
  assertEquals(getDurationLabel(history, 2), null)
})

Deno.test('getDurationLabel computes duration for simple turn', () => {
  const history: HistoryEntry[] = [
    agentStart('s1', 1_000),
    agentBlock('b1', 1_000, 61_000),
    agentEnd('e1', 61_000),
  ]

  // 60 seconds rounded from 61_000 - 1_000
  assertEquals(getDurationLabel(history, 2), 'Worked for 1m 0s')
})

Deno.test('getDurationLabel does not cross a previous agent-end', () => {
  const history: HistoryEntry[] = [
    agentStart('s1', 1_000),
    agentBlock('b1', 1_000, 10_000),
    agentEnd('e1', 10_000),
    userMessage('u1', 11_000),
    agentStart('s2', 20_000),
    agentBlock('b2', 20_000, 50_000),
    agentEnd('e2', 50_000),
  ]

  assertEquals(getDurationLabel(history, 2), 'Worked for 9s')
  assertEquals(getDurationLabel(history, 6), 'Worked for 30s')
})

Deno.test('getDurationLabel spans steers and multiple agent blocks', () => {
  const history: HistoryEntry[] = [
    agentStart('s1', 1_000),
    agentBlock('b1', 1_000, 10_000),
    userMessage('u-steer-1', 12_000),
    userMessage('u-steer-2', 13_000),
    agentBlock('b2', 14_000, 30_000),
    agentEnd('e1', 31_000),
  ]

  // Duration is still measured from the original agent-start to the final
  // agent-end, ignoring steers and additional agent blocks.
  assertEquals(getDurationLabel(history, 5), 'Worked for 30s')
})

Deno.test('getDurationLabel returns null when no matching agent-start exists', () => {
  const history: HistoryEntry[] = [
    userMessage('u1', 1_000),
    agentEnd('e1', 5_000),
  ]

  assertEquals(getDurationLabel(history, 1), null)
})

Deno.test('getDurationLabel returns null when interrupted and no agent-end is present', () => {
  const history: HistoryEntry[] = [
    agentStart('s1', 1_000),
    agentBlock('b1', 1_000, 5_000),
    interruption('int1', 6_000),
  ]

  // No agent-end entry at all, so there is no duration label.
  assertEquals(getDurationLabel(history, 2), null)
})
