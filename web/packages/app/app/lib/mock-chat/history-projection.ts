import type { CustomEntry, HistoryEntry } from './types.ts'

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Compute a "Worked for X" label for a given agent-end entry by pairing it
 * with the most recent preceding agent-start, without crossing another
 * agent-end. Steer messages and additional agent blocks are treated as part
 * of the same turn and do not affect the boundary.
 */
export function getDurationLabel(
  history: HistoryEntry[],
  endIndex: number,
): string | null {
  const endEntry = history[endIndex]
  if (
    endEntry.type !== 'custom' || endEntry.customType !== 'agent-end'
  ) {
    return null
  }

  let agentStart: CustomEntry | null = null
  for (let i = endIndex - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.type === 'custom' && entry.customType === 'agent-start') {
      agentStart = entry
      break
    }
    if (entry.type === 'custom' && entry.customType === 'agent-end') {
      break
    }
  }

  if (!agentStart) return null

  const duration = endEntry.timestamp - agentStart.timestamp
  return `Worked for ${formatDuration(duration)}`
}
