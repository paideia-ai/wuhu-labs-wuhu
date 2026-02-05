import { Form, Link, redirect, useLoaderData } from 'react-router'
import { useEffect, useMemo, useState } from 'react'
import type { Route } from './+types/sandboxes.$id.ts'
import {
  abortSandbox,
  sendSandboxPrompt,
  useSandboxStreams,
} from '~/lib/sandbox/use-sandbox.ts'
import type { UiMessage } from '~/lib/sandbox/types.ts'
import { queuedPromptIsRecordedInCoding } from '~/lib/sandbox/dedup.ts'
import {
  persistedMessagesToUiMessages,
  type PersistedSandboxMessage,
} from '~/lib/sandbox/history.ts'
import { initialCodingUiState } from '~/lib/sandbox/types.ts'
import { Button } from '@wuhu/shadcn/components/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@wuhu/shadcn/components/card'
import { Badge } from '@wuhu/shadcn/components/badge'
import { Textarea } from '@wuhu/shadcn/components/textarea'

function formatTimestamp(value?: number): string {
  const date = value ? new Date(value) : new Date()
  return date.toLocaleTimeString([], { hour12: false })
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

export default function SandboxDetail() {
  const { sandbox, persistedMessages, persistedCursor } = useLoaderData<
    typeof loader
  >()

  const initialCodingState = useMemo(() => {
    return {
      ...initialCodingUiState,
      cursor: persistedCursor,
      messages: persistedMessagesToUiMessages(persistedMessages),
    }
  }, [persistedCursor, persistedMessages])

  const { coding, control, connectionStatus } = useSandboxStreams(sandbox.id, {
    initialCodingState,
    reconnect: true,
  })
  const [prompt, setPrompt] = useState('')
  const [pendingPrompts, setPendingPrompts] = useState<UiMessage[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [aborting, setAborting] = useState(false)

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
    setSendError(null)
    setSending(true)
    setPrompt('')
    const localPrompt: UiMessage = {
      id: `local-prompt-${Date.now()}`,
      role: 'user',
      title: 'You',
      text,
      status: 'complete',
      timestamp: formatTimestamp(),
    }
    setPendingPrompts((prev) => [...prev, localPrompt].slice(-20))
    try {
      await sendSandboxPrompt({ sandboxId: sandbox.id, message: text })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSendError(message)
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    if (!pendingPrompts.length) return
    const queuedMessages = new Set(control.prompts.map((p) => p.message))
    setPendingPrompts((prev) => prev.filter((m) => !queuedMessages.has(m.text)))
  }, [control.prompts, pendingPrompts.length])

  const displayMessages = useMemo(() => {
    const controlMessages: UiMessage[] = control.prompts
      .filter((p) => {
        return !queuedPromptIsRecordedInCoding(p, coding.messages)
      })
      .map((p) => ({
        id: `queued-prompt-${p.cursor}`,
        role: 'user',
        title: 'You',
        text: p.message,
        status: 'pending',
        cursor: p.cursor,
        timestamp: formatTimestamp(p.timestamp),
      }))

    const all = [...controlMessages, ...coding.messages, ...pendingPrompts]
    const byId = new Map<string, UiMessage>()
    for (const m of all) {
      if (!byId.has(m.id)) byId.set(m.id, m)
    }
    return [...byId.values()].sort((a, b) => {
      const aCursor = a.cursor ?? Number.POSITIVE_INFINITY
      const bCursor = b.cursor ?? Number.POSITIVE_INFINITY
      if (aCursor !== bCursor) return aCursor - bCursor
      return a.id.localeCompare(b.id)
    })
  }, [coding.messages, control.prompts, pendingPrompts])

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
    <div className='container mx-auto p-8 max-w-4xl'>
      <Button variant='ghost' size='sm' asChild className='mb-4'>
        <Link to='/'>← Back</Link>
      </Button>

      <div className='flex items-baseline justify-between gap-4 mb-6'>
        <h1 className='text-3xl font-bold'>{sandbox.name || sandbox.id}</h1>
        <div className='flex gap-2 items-center'>
          <Badge variant={statusVariant}>{control.statusLabel}</Badge>
          <span className='text-sm text-muted-foreground'>
            {connectionStatus}
          </span>
        </div>
      </div>

      <Card className='mb-6'>
        <CardContent className='pt-6 space-y-2'>
          <p className='text-sm'>
            <span className='text-muted-foreground'>Pod status:</span>{' '}
            <span className='font-medium'>{sandbox.status}</span>
          </p>
          <p className='text-sm'>
            <span className='text-muted-foreground'>Repo:</span>{' '}
            <span className='font-medium'>
              {sandbox.repoFullName ?? 'None'}
            </span>
          </p>
          <p className='text-sm'>
            <span className='text-muted-foreground'>Preview:</span>{' '}
            <a
              href={sandbox.previewUrl}
              target='_blank'
              rel='noreferrer'
              className='text-primary hover:underline'
            >
              {sandbox.previewUrl}
            </a>
          </p>
          <p className='text-sm text-muted-foreground'>
            Namespace: {sandbox.namespace} · Job: {sandbox.jobName}
          </p>
          <p className='text-sm text-muted-foreground'>
            Pod: {sandbox.podName ?? 'Pending'} · IP:{' '}
            {sandbox.podIp ?? 'Pending'}
          </p>
        </CardContent>
      </Card>

      {control.error && <p className='text-destructive mb-4'>{control.error}
      </p>}

      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle>Agent Chat</CardTitle>
            <span className='text-sm text-muted-foreground'>
              Agent: {coding.agentStatus} · Cursor: {coding.cursor}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className='flex gap-2 mb-4'>
            <Button
              variant='outline'
              size='sm'
              onClick={handleAbort}
              disabled={aborting}
            >
              Abort
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

          <div className='border rounded-lg p-3 h-[360px] overflow-auto bg-muted/30 mb-4'>
            {displayMessages.length === 0
              ? (
                <div className='text-muted-foreground'>
                  Waiting for messages…
                </div>
              )
              : (
                <div className='space-y-3'>
                  {displayMessages.map((message) => (
                    <Card key={message.id} className='bg-background'>
                      <CardContent className='p-3'>
                        <div className='flex justify-between text-sm text-muted-foreground mb-1'>
                          <span>
                            {message.title || message.role}
                            {message.status === 'streaming' ? ' (typing)' : ''}
                          </span>
                          <span>{message.timestamp ?? ''}</span>
                        </div>
                        <pre className='whitespace-pre-wrap break-words font-mono text-sm'>
                        {message.text || (message.status === 'streaming' ? '...' : '')}
                        </pre>
                        {message.toolCalls?.length
                          ? (
                            <div className='flex flex-wrap gap-1 mt-2'>
                              {message.toolCalls.map((tool) => (
                                <Badge
                                  key={tool.id || tool.name}
                                  variant='secondary'
                                  className='text-xs'
                                >
                                  {tool.name}
                                </Badge>
                              ))}
                            </div>
                          )
                          : null}
                        {message.thinking
                          ? (
                            <details className='mt-2'>
                              <summary className='cursor-pointer text-sm text-muted-foreground'>
                                Reasoning
                              </summary>
                              <pre className='mt-2 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground'>
                            {message.thinking}
                              </pre>
                            </details>
                          )
                          : null}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
          </div>

          <div className='space-y-2'>
            <Textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Send a follow-up prompt…'
            />
            <div className='flex justify-between items-center'>
              <span className='text-sm text-muted-foreground'>
                Shift+Enter for a new line.
              </span>
              <Button
                onClick={handleSend}
                disabled={!prompt.trim() || sending}
              >
                Send
              </Button>
            </div>
            {sendError && (
              <p className='text-destructive text-sm'>{sendError}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
