import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@wuhu/shadcn/components/button'
import { Badge } from '@wuhu/shadcn/components/badge'
import { useMockSession } from '~/lib/mock-chat/use-mock-session.ts'
import type { AgentStyle } from '~/lib/mock-chat/types.ts'
import { HistoryList } from '~/lib/mock-chat/components/history-list.tsx'
import { StreamingMessageDisplay } from '~/lib/mock-chat/components/streaming-message.tsx'
import { InputArea } from '~/lib/mock-chat/components/input-area.tsx'

export function meta() {
  return [
    { title: 'Mock Agent Chat — Wuhu' },
  ]
}

export default function MockChatPage() {
  const [style, setStyle] = useState<AgentStyle>('anthropic')
  const { snapshot, sendMessage, interrupt, setQueueMode } = useMockSession(
    style,
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [snapshot.history.length, snapshot.streamingMessage?.content])

  return (
    <div className='flex h-dvh flex-col bg-[radial-gradient(circle_at_top,oklch(0.99_0.01_95)_0%,oklch(0.97_0.01_90)_40%,oklch(0.94_0.01_85)_100%)]'>
      {/* Header */}
      <header className='border-b bg-background/85 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3'>
          <div className='flex items-center gap-3'>
            <Button variant='ghost' size='sm' asChild>
              <Link to='/'>Back</Link>
            </Button>
            <h1 className='text-lg font-semibold'>Mock Agent Chat</h1>
            <Badge variant={snapshot.isGenerating ? 'default' : 'secondary'}>
              {snapshot.isGenerating ? 'Generating' : 'Idle'}
            </Badge>
          </div>
          <div className='flex items-center gap-2'>
            <span className='text-xs text-muted-foreground'>Style:</span>
            <Button
              variant={style === 'anthropic' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setStyle('anthropic')}
            >
              Anthropic
            </Button>
            <Button
              variant={style === 'openai' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setStyle('openai')}
            >
              OpenAI
            </Button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className='mx-auto grid h-full min-h-0 w-full max-w-4xl grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_240px]'>
        {/* Chat area */}
        <section className='flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-background/90 shadow-sm'>
          <div className='flex-1 space-y-4 overflow-auto px-4 py-4'>
            {snapshot.history.length === 0 && !snapshot.streamingMessage && (
              <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
                Send a message to start the mock agent conversation.
              </div>
            )}

            <HistoryList history={snapshot.history} />

            {snapshot.streamingMessage && (
              <StreamingMessageDisplay message={snapshot.streamingMessage} />
            )}

            {snapshot.isGenerating && !snapshot.streamingMessage && (
              <div className='flex justify-start'>
                <div className='rounded-2xl border bg-background px-4 py-3 text-sm text-muted-foreground'>
                  <span className='inline-flex items-center gap-1'>
                    <span className='inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40' />
                    <span className='inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40 [animation-delay:150ms]' />
                    <span className='inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40 [animation-delay:300ms]' />
                  </span>
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          <InputArea
            isGenerating={snapshot.isGenerating}
            queueMode={snapshot.queueMode}
            onSend={sendMessage}
            onInterrupt={interrupt}
            onQueueModeChange={setQueueMode}
          />
        </section>

        {/* Queue sidebar */}
        <aside className='flex min-h-0 flex-col gap-4'>
          <QueueSection title='Steer Queue' messages={snapshot.steerQueue} />
          <QueueSection
            title='Follow-up Queue'
            messages={snapshot.followUpQueue}
          />
        </aside>
      </div>
    </div>
  )
}

function QueueSection({
  title,
  messages,
}: {
  title: string
  messages: { id: string; text: string; timestamp: number }[]
}) {
  return (
    <section className='rounded-2xl border bg-background/90 p-4 shadow-sm'>
      <h2 className='mb-2 text-sm font-semibold'>{title}</h2>
      {messages.length === 0
        ? <p className='text-sm text-muted-foreground'>Empty</p>
        : (
          <div className='space-y-2'>
            {messages.map((msg) => (
              <div key={msg.id} className='rounded-xl border p-2'>
                <p className='line-clamp-3 text-sm'>{msg.text}</p>
              </div>
            ))}
          </div>
        )}
    </section>
  )
}
