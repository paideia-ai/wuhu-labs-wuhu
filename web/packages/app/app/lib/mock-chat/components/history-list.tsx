import { memo } from 'react'
import type { HistoryEntry } from '../types.ts'
import { AgentBlock } from './agent-block.tsx'
import { getDurationLabel } from '../history-projection.ts'

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
