import { memo } from 'react'
import { AgentBlock } from './agent-block.tsx'
import type { MockChatProjection } from '../projection.ts'

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

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function HistoryListInner(
  { projection }: { projection: MockChatProjection },
) {
  return (
    <div className='space-y-4'>
      {projection.turns.map((turn) => {
        const { prompt, blocks, startedAt, endedAt } = turn
        const showDuration = endedAt !== null &&
          blocks.length > 0 &&
          blocks[blocks.length - 1]?.endReason === 'completed'

        return (
          <div key={turn.id} className='space-y-3'>
            <UserMessageBubble text={prompt.text} />

            {blocks.map((block) => (
              <div key={block.id} className='space-y-2'>
                <AgentBlock block={block} />

                {block.endReason === 'interrupted' && <InterruptionBadge />}

                {block.isLastBlockInTurn && showDuration && endedAt !== null &&
                  (
                    <DurationLabel
                      label={`Worked for ${
                        formatDuration(endedAt - startedAt)
                      }`}
                    />
                  )}
              </div>
            ))}
          </div>
        )
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
