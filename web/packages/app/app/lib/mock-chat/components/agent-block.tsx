import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentBlockView } from '../projection.ts'
import { type RenderBlock, type ToolGroup } from '../tool-grouping.ts'

function categoryLabel(category: ToolGroup['category']): string {
  switch (category) {
    case 'exploration':
      return 'Exploration'
    case 'mutation':
      return 'Mutation'
    case 'execution':
      return 'Execution'
  }
}

function categoryColor(category: ToolGroup['category']): string {
  switch (category) {
    case 'exploration':
      return 'text-blue-600'
    case 'mutation':
      return 'text-amber-600'
    case 'execution':
      return 'text-emerald-600'
  }
}

function ToolGroupDisplay({ group }: { group: ToolGroup }) {
  return (
    <div className='rounded-lg border border-dashed px-3 py-2'>
      <p
        className={`text-xs font-medium uppercase tracking-wide ${
          categoryColor(group.category)
        }`}
      >
        {categoryLabel(group.category)}
      </p>
      <ul className='mt-1 space-y-0.5'>
        {group.lines.map((line, i) => (
          <li key={i} className='truncate text-xs text-muted-foreground'>
            <span className='font-mono'>{line.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RenderBlockDisplay({ block }: { block: RenderBlock }) {
  if (block.kind === 'tool-group') {
    return <ToolGroupDisplay group={block.group} />
  }

  const item = block.item
  if (item.type === 'assistant-message') {
    return (
      <div className='prose prose-sm max-w-none text-foreground'>
        <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
      </div>
    )
  }

  if (item.type === 'reasoning-summary') {
    return (
      <details className='rounded-lg border bg-muted/30 px-3 py-2'>
        <summary className='cursor-pointer text-xs font-medium text-muted-foreground'>
          Reasoning
        </summary>
        <div className='mt-2 text-sm text-muted-foreground'>
          {item.content}
        </div>
      </details>
    )
  }

  return null
}

function AgentBlockInner({ block }: { block: AgentBlockView }) {
  const renderBlocks = block.renderBlocks

  if (renderBlocks.length === 0) {
    return (
      <div className='rounded-xl border border-dashed p-3 text-sm text-muted-foreground'>
        Working...
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {renderBlocks.map((rb, i) => <RenderBlockDisplay key={i} block={rb} />)}
    </div>
  )
}

/**
 * Memoized agent block component. Once a block is complete (endedAt !== null),
 * it will never re-render because the block reference is stable.
 */
export const AgentBlock = memo(AgentBlockInner)
