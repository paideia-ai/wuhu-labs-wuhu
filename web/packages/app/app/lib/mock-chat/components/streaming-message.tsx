import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { StreamingMessage as StreamingMessageType } from '../types.ts'

export function StreamingMessageDisplay({
  message,
}: {
  message: StreamingMessageType
}) {
  return (
    <div className='flex justify-start'>
      <div className='max-w-[90%] rounded-2xl border bg-background px-4 py-3 text-sm text-foreground'>
        <div className='prose prose-sm max-w-none'>
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>
        <span className='inline-block h-4 w-1.5 animate-pulse bg-foreground/60' />
      </div>
    </div>
  )
}
