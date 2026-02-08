import type { CustomEntry, HistoryEntry, UserMessageEntry } from './types.ts'

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function isTurnEnd(entry: HistoryEntry): boolean {
  return entry.type === 'custom' &&
    (entry.customType === 'agent-end' || entry.customType === 'interruption')
}

/**
 * Compute a "Worked for X" label for a given turn-ending entry (agent-end or
 * interruption) by pairing it with the most recent preceding user-message,
 * without crossing another turn-ending marker. Steer messages and additional
 * agent blocks are treated as part of the same turn.
 */
export function getDurationLabel(
  history: HistoryEntry[],
  endIndex: number,
): string | null {
  const endEntry = history[endIndex]
  if (endEntry.type !== 'custom') return null
  if (
    endEntry.customType !== 'agent-end' &&
    endEntry.customType !== 'interruption'
  ) {
    return null
  }
  const turnEnd: CustomEntry = endEntry

  // Walk backwards, collecting user-messages until we hit a turn-end
  // boundary. Steer messages are user-messages too, so we keep walking
  // past them. The earliest user-message found is the turn-starting one.
  let turnStart: UserMessageEntry | null = null
  for (let i = endIndex - 1; i >= 0; i--) {
    const entry = history[i]
    if (isTurnEnd(entry)) {
      break
    }
    if (entry.type === 'user-message') {
      turnStart = entry
    }
  }

  if (!turnStart) return null

  const duration = turnEnd.timestamp - turnStart.timestamp
  return `Worked for ${formatDuration(duration)}`
}
