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
 * Look for agent-start before and agent-end after a given index to compute
 * a "Worked for X" duration label.
 */
function getDurationLabel(
  history: HistoryEntry[],
  blockIndex: number,
): string | null {
  // Look backwards for agent-start
  let agentStart: CustomEntry | null = null
  for (let i = blockIndex - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.type === 'custom' && entry.customType === 'agent-start') {
      agentStart = entry
      break
    }
    // Stop searching if we hit another agent-block or user-message
    if (entry.type === 'agent-block' || entry.type === 'user-message') break
  }

  // Look forwards for agent-end
  let agentEnd: CustomEntry | null = null
  for (let i = blockIndex + 1; i < history.length; i++) {
    const entry = history[i]
    if (entry.type === 'custom' && entry.customType === 'agent-end') {
      agentEnd = entry
      break
    }
    if (entry.type === 'agent-block' || entry.type === 'user-message') break
  }

  if (!agentStart || !agentEnd) return null

  const duration = agentEnd.timestamp - agentStart.timestamp
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
            // triggers a duration label on the preceding agent block
            if (entry.customType === 'agent-end') {
              // Find the agent block before this
              for (let i = index - 1; i >= 0; i--) {
                if (history[i].type === 'agent-block') {
                  const label = getDurationLabel(history, i)
                  if (label) {
                    return <DurationLabel key={entry.id} label={label} />
                  }
                  break
                }
                if (history[i].type === 'user-message') break
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
