import { memo } from 'react'
import type { CustomEntry, HistoryEntry } from '../types.ts'
import { AgentBlock } from './agent-block.tsx'

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Compute a "Worked for X" label for a given agent-end entry by pairing it
 * with the most recent preceding agent-start (without crossing another
 * agent-end). Steer messages are treated as part of the same turn and do
 * not affect the boundary.
 */
function getDurationLabel(
  history: HistoryEntry[],
  endIndex: number,
): string | null {
  const endEntry = history[endIndex]
  if (
    endEntry.type !== 'custom' || endEntry.customType !== 'agent-end'
  ) {
    return null
  }

  // Look backwards for the matching agent-start, stopping if we hit a
  // previous agent-end (which would belong to an earlier turn).
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

function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className='flex justify-end'>
      <div className='max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground'>
        <pre className='whitespace-pre-wrap break-words font-sans'>{text}</pre>
      </div>
    </div>
  )
}

function InterruptionBadge() {
  return (
    <div className='flex justify-center'>
      <span className='rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive'>
        Generation interrupted
      </span>
    </div>
  )
}

function DurationLabel({ label }: { label: string }) {
  return <p className='text-center text-xs text-muted-foreground'>{label}</p>
}

function HistoryListInner({ history }: { history: HistoryEntry[] }) {
  return (
    <div className='space-y-4'>
      {history.map((entry, index) => {
        switch (entry.type) {
          case 'user-message':
            return <UserMessageBubble key={entry.id} text={entry.text} />

          case 'custom':
            if (entry.customType === 'interruption') {
              return <InterruptionBadge key={entry.id} />
            }
            // agent-start and agent-end are invisible — but agent-end
            // triggers a duration label for the turn
            if (entry.customType === 'agent-end') {
              const label = getDurationLabel(history, index)
              if (label) {
                return <DurationLabel key={entry.id} label={label} />
              }
            }
            return null

          case 'agent-block':
            return <AgentBlock key={entry.id} block={entry} />
        }
      })}
    </div>
  )
}

/**
 * Memoized history list. Only re-renders when the history array reference
 * changes (new entries appended or agent block items updated). Does NOT
 * re-render during streaming.
 */
export const HistoryList = memo(HistoryListInner)
