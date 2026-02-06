import { Form, Link, redirect, useLoaderData } from 'react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Route } from './+types/sandboxes.$id.ts'
import {
  abortSandbox,
  sendSandboxPrompt,
  useSandboxStreams,
} from '~/lib/sandbox/use-sandbox.ts'
import {
  persistedMessagesToUiMessages,
  type PersistedSandboxMessage,
} from '~/lib/sandbox/history.ts'
import { initialCodingUiState, type UiMessage } from '~/lib/sandbox/types.ts'
import {
  type PendingPromptDraft,
  projectAgentChatState,
  type TurnView,
} from '~/lib/sandbox/chat-projection.ts'
import { Button } from '@wuhu/shadcn/components/button'
import { Badge } from '@wuhu/shadcn/components/badge'
import { Textarea } from '@wuhu/shadcn/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wuhu/shadcn/components/select'

function formatDateTime(value?: number): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return date.toLocaleString()
}

function queueModeLabel(mode: 'steer' | 'followUp'): string {
  return mode === 'steer' ? 'Steer' : 'Follow-up'
}

async function fetchSandbox(apiUrl: string, sandboxId: string) {
  const response = await fetch(`${apiUrl}/sandboxes/${sandboxId}`)
  if (!response.ok) {
    throw new Response('Sandbox not found', { status: 404 })
  }
  const data = await response.json()
  return data.sandbox
}

async function fetchSandboxMessages(apiUrl: string, sandboxId: string) {
  const limit = 500
  const all: PersistedSandboxMessage[] = []
  let cursor = 0
  for (let i = 0; i < 20; i++) {
    const response = await fetch(
      `${apiUrl}/sandboxes/${sandboxId}/messages?cursor=${cursor}&limit=${limit}`,
    )
    if (!response.ok) {
      throw new Response('Failed to load sandbox messages', { status: 500 })
    }
    const data = await response.json() as {
      messages: PersistedSandboxMessage[]
      cursor: number
      hasMore: boolean
    }
    all.push(...(Array.isArray(data.messages) ? data.messages : []))
    cursor = typeof data.cursor === 'number' ? data.cursor : cursor
    if (!data.hasMore) break
  }
  return { messages: all, cursor }
}

export async function loader({ params }: Route.LoaderArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  const sandboxId = String(params.id ?? '')
  if (!sandboxId) {
    throw new Response('Sandbox not found', { status: 404 })
  }

  const [sandbox, messagesResult] = await Promise.all([
    fetchSandbox(apiUrl, sandboxId),
    fetchSandboxMessages(apiUrl, sandboxId),
  ])

  return {
    sandbox,
    persistedMessages: messagesResult.messages,
    persistedCursor: messagesResult.cursor,
  }
}

export async function action({ params, request }: Route.ActionArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  const formData = await request.formData()
  const actionType = String(formData.get('_action') ?? '')

  if (actionType === 'kill') {
    await fetch(`${apiUrl}/sandboxes/${params.id}/kill`, { method: 'POST' })
    return redirect('/')
  }

  return null
}

function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={isUser
          ? 'max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground'
          : 'max-w-[90%] rounded-2xl border bg-background px-4 py-3 text-sm text-foreground'}
      >
        <pre className='whitespace-pre-wrap break-words font-sans'>
          {message.text || '...'}
        </pre>
      </div>
    </div>
  )
}

function TraceDialog({
  turn,
  onClose,
}: {
  turn: TurnView
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      role='dialog'
      aria-modal='true'
      aria-label='Turn trace details'
    >
      <div className='absolute inset-0' onClick={onClose} />
      <div className='relative z-10 flex h-[80dvh] w-full max-w-3xl flex-col rounded-2xl border bg-background shadow-xl'>
        <div className='flex items-center justify-between border-b px-5 py-3'>
          <div>
            <p className='text-xs uppercase tracking-wide text-muted-foreground'>
              Turn {turn.turnIndex}
            </p>
            <h2 className='text-lg font-semibold'>Trace Preview</h2>
          </div>
          <Button variant='outline' size='sm' onClick={onClose}>Close</Button>
        </div>
        <div className='flex-1 space-y-3 overflow-auto p-5'>
          {turn.traceItems.length === 0
            ? (
              <p className='text-sm text-muted-foreground'>
                No trace items were captured for this turn.
              </p>
            )
            : turn.traceItems.map((item) => {
              if (
                item.kind === 'message' &&
                item.role === 'assistant' &&
                item.messageId === turn.assistantMessage?.id
              ) {
                return null
              }

              if (item.kind === 'message') {
                return (
                  <div key={item.id} className='rounded-xl border p-3'>
                    <p className='mb-1 text-xs uppercase tracking-wide text-muted-foreground'>
                      Message · {item.role}
                    </p>
                    <pre className='whitespace-pre-wrap break-words text-sm'>
                      {item.text || '...'}
                    </pre>
                  </div>
                )
              }

              return (
                <div key={item.id} className='rounded-xl border p-3'>
                  <p className='mb-1 text-xs uppercase tracking-wide text-muted-foreground'>
                    Tool Call
                  </p>
                  <p className='text-sm font-medium'>{item.toolName}</p>
                  <p className='text-xs text-muted-foreground'>
                    Status: {item.status}
                  </p>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

function PodStatusDialog({
  sandbox,
  onClose,
}: {
  sandbox: {
    id: string
    status: string
    namespace: string
    jobName: string
    podName: string | null
    podIp: string | null
    daemonPort: number
    previewUrl: string
    repoFullName: string | null
    createdAt: string
    updatedAt: string
  }
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      role='dialog'
      aria-modal='true'
      aria-label='Pod status'
    >
      <div className='absolute inset-0' onClick={onClose} />
      <div className='relative z-10 w-full max-w-xl rounded-2xl border bg-background p-5 shadow-xl'>
        <div className='mb-4 flex items-start justify-between gap-3'>
          <div>
            <p className='text-xs uppercase tracking-wide text-muted-foreground'>
              Sandbox Infrastructure
            </p>
            <h2 className='text-lg font-semibold'>Pod Status</h2>
          </div>
          <Button variant='outline' size='sm' onClick={onClose}>Close</Button>
        </div>

        <div className='space-y-2 text-sm'>
          <p>
            <span className='text-muted-foreground'>Sandbox:</span> {sandbox.id}
          </p>
          <p>
            <span className='text-muted-foreground'>State:</span>{' '}
            {sandbox.status}
          </p>
          <p>
            <span className='text-muted-foreground'>Namespace:</span>{' '}
            {sandbox.namespace}
          </p>
          <p>
            <span className='text-muted-foreground'>Job:</span>{' '}
            {sandbox.jobName}
          </p>
          <p>
            <span className='text-muted-foreground'>Pod:</span>{' '}
            {sandbox.podName ?? 'Pending'}
          </p>
          <p>
            <span className='text-muted-foreground'>Pod IP:</span>{' '}
            {sandbox.podIp ?? 'Pending'}
          </p>
          <p>
            <span className='text-muted-foreground'>Daemon Port:</span>{' '}
            {sandbox.daemonPort}
          </p>
          <p>
            <span className='text-muted-foreground'>Repo:</span>{' '}
            {sandbox.repoFullName ?? 'None'}
          </p>
          <p>
            <span className='text-muted-foreground'>Preview:</span>{' '}
            <a
              href={sandbox.previewUrl}
              target='_blank'
              rel='noreferrer'
              className='text-primary underline'
            >
              {sandbox.previewUrl}
            </a>
          </p>
          <p>
            <span className='text-muted-foreground'>Created:</span>{' '}
            {sandbox.createdAt}
          </p>
          <p>
            <span className='text-muted-foreground'>Updated:</span>{' '}
            {sandbox.updatedAt}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SandboxDetail() {
  const { sandbox, persistedMessages, persistedCursor } = useLoaderData<
    typeof loader
  >()

  const initialCodingState = useMemo(() => {
    const messages = persistedMessagesToUiMessages(persistedMessages)
    const maxTurnIndex = messages.reduce(
      (max, message) => Math.max(max, message.turnIndex ?? 0),
      0,
    )
    return {
      ...initialCodingUiState,
      cursor: persistedCursor,
      messages,
      nextTurnIndex: maxTurnIndex,
    }
  }, [persistedCursor, persistedMessages])

  const { coding, control, connectionStatus } = useSandboxStreams(sandbox.id, {
    initialCodingState,
    reconnect: true,
  })

  const [prompt, setPrompt] = useState('')
  const [queueMode, setQueueMode] = useState<'steer' | 'followUp'>('followUp')
  const [pendingPrompts, setPendingPrompts] = useState<PendingPromptDraft[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [traceTurn, setTraceTurn] = useState<TurnView | null>(null)
  const [showPodDialog, setShowPodDialog] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const id = globalThis.setInterval(() => setNowMs(Date.now()), 1000)
    return () => globalThis.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!pendingPrompts.length) return
    const queued = new Set(
      control.prompts.map((prompt) =>
        `${prompt.streamingBehavior ?? 'followUp'}:${prompt.message}`
      ),
    )
    setPendingPrompts((prev) =>
      prev.filter((draft) =>
        !queued.has(`${draft.streamingBehavior}:${draft.message}`)
      )
    )
  }, [control.prompts, pendingPrompts.length])

  const projection = useMemo(
    () =>
      projectAgentChatState({
        coding,
        control,
        pendingPrompts,
        nowMs,
      }),
    [coding, control, pendingPrompts, nowMs],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [
    projection.completedTurns.length,
    projection.activeTurn?.workedForLabel,
    projection.queuePrompts.length,
  ])

  const statusVariant = useMemo(() => {
    if (
      control.statusLabel === 'Ready' || control.statusLabel === 'Initialized'
    ) {
      return 'default'
    }
    if (control.statusLabel.includes('error')) return 'destructive'
    if (control.statusLabel === 'Terminated') return 'secondary'
    return 'outline'
  }, [control.statusLabel])

  const handleSend = async () => {
    const text = prompt.trim()
    if (!text || sending) return

    const localDraft: PendingPromptDraft = {
      id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message: text,
      timestampMs: Date.now(),
      streamingBehavior: queueMode,
    }

    setSendError(null)
    setSending(true)
    setPrompt('')
    setPendingPrompts((prev) => [...prev, localDraft].slice(-50))

    try {
      await sendSandboxPrompt({
        sandboxId: sandbox.id,
        message: text,
        streamingBehavior: queueMode,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSendError(message)
      setPendingPrompts((prev) =>
        prev.filter((item) => item.id !== localDraft.id)
      )
      setPrompt(text)
    } finally {
      setSending(false)
    }
  }

  const handleAbort = async () => {
    if (aborting) return
    setAborting(true)
    try {
      await abortSandbox({ sandboxId: sandbox.id })
    } finally {
      setAborting(false)
    }
  }

  return (
    <div className='flex h-dvh flex-col bg-[radial-gradient(circle_at_top,oklch(0.99_0.01_95)_0%,oklch(0.97_0.01_90)_40%,oklch(0.94_0.01_85)_100%)]'>
      <header className='border-b bg-background/85 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3'>
          <div className='min-w-0'>
            <div className='mb-1 flex items-center gap-2'>
              <Button variant='ghost' size='sm' asChild>
                <Link to='/'>Back</Link>
              </Button>
              <Badge variant={statusVariant}>{control.statusLabel}</Badge>
            </div>
            <h1 className='truncate text-xl font-semibold'>
              {sandbox.name || sandbox.id}
            </h1>
            <p className='text-xs text-muted-foreground'>
              Agent: {coding.agentStatus} · Connection: {connectionStatus}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setShowPodDialog(true)}
            >
              Pod Status
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={handleAbort}
              disabled={aborting}
            >
              {aborting ? 'Aborting…' : 'Abort'}
            </Button>
            <Form method='post'>
              <Button
                type='submit'
                name='_action'
                value='kill'
                variant='destructive'
                size='sm'
              >
                Kill Sandbox
              </Button>
            </Form>
          </div>
        </div>
      </header>

      <div className='mx-auto grid h-full min-h-0 w-full max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <section className='flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-background/90 shadow-sm'>
          <div className='border-b px-4 py-3 text-xs text-muted-foreground'>
            Turns are grouped by agentic loop. Trace details are hidden behind
            each "Worked for ..." summary.
          </div>

          <div className='flex-1 space-y-4 overflow-auto px-4 py-4'>
            {projection.completedTurns.length === 0 && !projection.activeTurn
              ? (
                <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
                  Waiting for the first turn.
                </div>
              )
              : null}

            {projection.completedTurns.map((turn) => (
              <div key={`turn-${turn.turnIndex}`} className='space-y-2'>
                {turn.userMessage && (
                  <MessageBubble message={turn.userMessage} />
                )}

                {turn.workedForLabel && (
                  <button
                    type='button'
                    className='text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
                    onClick={() => setTraceTurn(turn)}
                  >
                    {turn.workedForLabel}
                  </button>
                )}

                {turn.assistantMessage && (
                  <MessageBubble message={turn.assistantMessage} />
                )}
              </div>
            ))}

            {projection.activeTurn && (
              <div className='space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3'>
                {projection.activeTurn.userMessage && (
                  <MessageBubble message={projection.activeTurn.userMessage} />
                )}
                <div className='rounded-lg border border-amber-300 bg-amber-100/40 p-3'>
                  <p className='text-sm font-medium text-amber-900'>
                    {projection.activeTurn.workedForLabel ?? 'Working...'}
                  </p>
                  <p className='mt-1 text-xs text-amber-900/80'>
                    Trace output is hidden until the turn finishes.
                  </p>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className='border-t p-4'>
            <div className='mb-2 flex flex-wrap items-center gap-2'>
              <Select
                value={queueMode}
                onValueChange={(value) => {
                  if (value === 'steer' || value === 'followUp') {
                    setQueueMode(value)
                  }
                }}
              >
                <SelectTrigger className='w-[180px]'>
                  <SelectValue placeholder='Queue behavior' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='followUp'>Follow-up queue</SelectItem>
                  <SelectItem value='steer'>Steer queue</SelectItem>
                </SelectContent>
              </Select>
              <span className='text-xs text-muted-foreground'>
                Current mode: {queueModeLabel(queueMode)}
              </span>
            </div>

            <Textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder='Send a steer/follow-up prompt...'
            />
            <div className='mt-2 flex items-center justify-between'>
              <p className='text-xs text-muted-foreground'>
                Enter sends. Shift+Enter inserts a new line.
              </p>
              <Button onClick={handleSend} disabled={!prompt.trim() || sending}>
                {sending ? 'Queueing…' : `Queue ${queueModeLabel(queueMode)}`}
              </Button>
            </div>
            {sendError && (
              <p className='mt-2 text-sm text-destructive'>{sendError}</p>
            )}
            {control.error && (
              <p className='mt-1 text-sm text-destructive'>{control.error}</p>
            )}
          </div>
        </section>

        <aside className='flex min-h-0 flex-col gap-4'>
          <section className='rounded-2xl border bg-background/90 p-4 shadow-sm'>
            <h2 className='mb-2 text-sm font-semibold'>Queue</h2>
            {projection.queuePrompts.length === 0
              ? (
                <p className='text-sm text-muted-foreground'>
                  No queued prompts.
                </p>
              )
              : (
                <div className='space-y-2'>
                  {projection.queuePrompts.map((item) => (
                    <div key={item.id} className='rounded-xl border p-2'>
                      <div className='mb-1 flex items-center gap-2'>
                        <Badge
                          variant={item.status === 'queued'
                            ? 'secondary'
                            : 'outline'}
                        >
                          {item.status}
                        </Badge>
                        <Badge variant='outline'>
                          {queueModeLabel(item.streamingBehavior)}
                        </Badge>
                      </div>
                      <p className='line-clamp-4 text-sm'>{item.message}</p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {formatDateTime(item.timestampMs)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className='rounded-2xl border bg-background/90 p-4 shadow-sm'>
            <h2 className='mb-2 text-sm font-semibold'>Sandbox</h2>
            <div className='space-y-1 text-sm'>
              <p>
                <span className='text-muted-foreground'>Status:</span>{' '}
                {sandbox.status}
              </p>
              <p>
                <span className='text-muted-foreground'>Repo:</span>{' '}
                {sandbox.repoFullName ?? 'None'}
              </p>
              <p>
                <span className='text-muted-foreground'>Preview:</span>{' '}
                <a
                  href={sandbox.previewUrl}
                  target='_blank'
                  rel='noreferrer'
                  className='text-primary underline'
                >
                  Open
                </a>
              </p>
            </div>
          </section>
        </aside>
      </div>

      {traceTurn && (
        <TraceDialog
          turn={traceTurn}
          onClose={() => setTraceTurn(null)}
        />
      )}
      {showPodDialog && (
        <PodStatusDialog
          sandbox={sandbox}
          onClose={() => setShowPodDialog(false)}
        />
      )}
    </div>
  )
}
