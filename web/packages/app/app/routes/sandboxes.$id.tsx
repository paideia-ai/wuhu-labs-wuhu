import { useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Form, Link, redirect, useFetcher, useLoaderData } from 'react-router'
import type { Route } from './+types/sandboxes.$id.ts'
import {
  initialUiState,
  type SandboxDaemonEvent,
  type StreamEnvelope,
  type UiState,
} from '~/lib/sandbox-daemon/types.ts'
import { reduceEnvelope } from '~/lib/sandbox-daemon/streamReducer.ts'

function parseSseChunk(chunk: string): { id: string; data?: string } {
  const lines = chunk.split(/\r?\n/)
  const dataLines: string[] = []
  let id = ''

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  const data = dataLines.length ? dataLines.join('\n') : undefined
  return { id, data }
}

async function fetchSandbox(apiUrl: string, id: string) {
  const response = await fetch(`${apiUrl}/sandboxes/${id}`)
  if (!response.ok) {
    throw new Response('Sandbox not found', { status: 404 })
  }
  const data = await response.json()
  return data.sandbox
}

export async function loader({ params }: Route.LoaderArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }
  const id = params.id
  if (!id) {
    throw new Response('Sandbox id is required', { status: 400 })
  }
  const sandbox = await fetchSandbox(apiUrl, id)
  return { sandbox }
}

export async function action({ params, request }: Route.ActionArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }
  const id = params.id
  if (!id) {
    throw new Response('Sandbox id is required', { status: 400 })
  }

  const formData = await request.formData()
  const actionType = String(formData.get('_action') ?? '')

  if (actionType === 'kill') {
    await fetch(`${apiUrl}/sandboxes/${id}/kill`, { method: 'POST' })
    return redirect('/')
  }

  if (actionType === 'prompt') {
    const message = String(formData.get('message') ?? '').trim()
    if (!message) {
      return new Response('Prompt message is required', { status: 400 })
    }
    const sandbox = await fetchSandbox(apiUrl, id)
    if (!sandbox?.podIp || !sandbox?.daemonPort) {
      return new Response('Sandbox pod not ready', { status: 503 })
    }
    const response = await fetch(
      `http://${sandbox.podIp}:${sandbox.daemonPort}/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          streamingBehavior: 'followUp',
        }),
      },
    )
    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText || 'Prompt failed', { status: 500 })
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  if (actionType === 'abort') {
    const sandbox = await fetchSandbox(apiUrl, id)
    if (!sandbox?.podIp || !sandbox?.daemonPort) {
      return new Response('Sandbox pod not ready', { status: 503 })
    }
    const response = await fetch(
      `http://${sandbox.podIp}:${sandbox.daemonPort}/abort`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'user_abort' }),
      },
    )
    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText || 'Abort failed', { status: 500 })
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  return null
}

export default function SandboxDetail() {
  const { sandbox } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const [prompt, setPrompt] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const [streaming, setStreaming] = useState(false)

  const [state, dispatchEnvelope] = useReducer(
    (s: UiState, env: StreamEnvelope<SandboxDaemonEvent>) =>
      reduceEnvelope(s, env),
    initialUiState,
  )

  const streamAbortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.messages])

  const streamUrl = `/sandboxes/${sandbox.id}/stream`

  const startStream = async () => {
    if (streaming) return
    setConnectionStatus('Connecting...')
    setStreaming(true)
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      const res = await fetch(
        `${streamUrl}?cursor=${state.cursor}&follow=1`,
        {
          method: 'GET',
          signal: controller.signal,
        },
      )
      if (!res.ok || !res.body) {
        const text = await res.text()
        throw new Error(`Stream failed (${res.status}): ${text}`)
      }

      setConnectionStatus('Connected')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split(/\r?\n\r?\n/)
        buffer = parts.pop() || ''

        for (const part of parts) {
          if (!part.trim()) continue
          const parsed = parseSseChunk(part)
          if (!parsed.data) continue
          try {
            const envelope = JSON.parse(
              parsed.data,
            ) as StreamEnvelope<SandboxDaemonEvent>
            if (
              typeof envelope.cursor === 'number' &&
              envelope.event &&
              typeof envelope.event === 'object'
            ) {
              dispatchEnvelope(envelope)
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch (err) {
      const isAbort = err && typeof err === 'object' &&
        (err as { name?: string }).name === 'AbortError'
      if (!isAbort) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('Stream error', message)
        setConnectionStatus('Stream error')
      }
    } finally {
      setStreaming(false)
      setConnectionStatus('Disconnected')
      streamAbortRef.current = null
    }
  }

  const stopStream = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
    }
  }

  useEffect(() => {
    void startStream()
    return () => {
      stopStream()
    }
  }, [streamUrl])

  const handleSendPrompt = async () => {
    const text = prompt.trim()
    if (!text) return

    if (!streaming) {
      void startStream()
    }

    setPrompt('')

    fetcher.submit(
      { _action: 'prompt', message: text },
      { method: 'post' },
    )
  }

  const handleAbort = () => {
    fetcher.submit({ _action: 'abort' }, { method: 'post' })
  }

  const clearConversation = () => {
    dispatchEnvelope({
      cursor: 0,
      event: {
        source: 'daemon',
        type: 'reset',
      } as SandboxDaemonEvent,
    })
  }

  const clearActivities = () => {
    dispatchEnvelope({
      cursor: state.cursor,
      event: {
        source: 'daemon',
        type: 'clear_activities',
      } as SandboxDaemonEvent,
    })
  }

  const handlePromptKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSendPrompt()
    }
  }

  return (
    <div className='app'>
      <Link to='/'>← Back</Link>
      <header className='hero' style={{ marginTop: '16px' }}>
        <div className='hero__text'>
          <p className='eyebrow'>Wuhu Sandbox</p>
          <h1>{sandbox.name || sandbox.id}</h1>
          <p className='subtext'>
            Repo: <strong>{sandbox.repoFullName ?? 'None'}</strong>
          </p>
          <p className='subtext'>
            Preview:{' '}
            <a href={sandbox.previewUrl} target='_blank' rel='noreferrer'>
              {sandbox.previewUrl}
            </a>
          </p>
        </div>
        <div className='status'>
          <div className='status__label'>Connection</div>
          <div className='status__value'>{connectionStatus}</div>
          <div className='status__meta'>Agent: {state.agentStatus}</div>
          <div className='status__meta'>Cursor: {state.cursor}</div>
          <div className='status__meta'>
            Last event: {state.lastEventType || 'None'}
          </div>
        </div>
      </header>

      <section className='panel grid'>
        <div className='panel__block'>
          <label>Sandbox Status</label>
          <div>
            <strong>{sandbox.status}</strong>
          </div>
          <div className='helper'>Namespace: {sandbox.namespace}</div>
          <div className='helper'>Job: {sandbox.jobName}</div>
          <div className='helper'>Pod: {sandbox.podName ?? 'Pending'}</div>
          <div className='helper'>Pod IP: {sandbox.podIp ?? 'Pending'}</div>
        </div>
        <div className='panel__block panel__actions'>
          <label>Connection controls</label>
          <div className='actions'>
            <button type='button' onClick={startStream} disabled={streaming}>
              Connect
            </button>
            <button
              type='button'
              className='ghost'
              onClick={stopStream}
              disabled={!streaming}
            >
              Disconnect
            </button>
          </div>
          <p className='helper'>Status: {connectionStatus}</p>
        </div>
        <div className='panel__block panel__actions'>
          <label>Sandbox actions</label>
          <div className='actions'>
            <Form method='post'>
              <button type='submit' name='_action' value='kill'>
                Kill Sandbox
              </button>
            </Form>
          </div>
          <p className='helper'>Kill stops the job and clears the pod.</p>
        </div>
      </section>

      <section className='workspace'>
        <div className='panel chat'>
          <div className='panel__header chat__header'>
            <div>
              <h2>Agent Thread</h2>
              <p className='subtext small'>
                Messages stream from the daemon. Use Shift+Enter for a new line.
              </p>
            </div>
            <div className='controls'>
              <button
                type='button'
                className='ghost'
                onClick={handleAbort}
                disabled={!streaming}
              >
                Abort
              </button>
              <button type='button' onClick={clearConversation}>
                Clear
              </button>
            </div>
          </div>

          <div className='chat__log' ref={logRef}>
            {state.messages.length === 0
              ? (
                <div className='chat__empty'>
                  No messages yet. Send a prompt to begin.
                </div>
              )
              : (
                state.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`message message--${message.role} ${
                      message.status === 'streaming' ? 'message--streaming' : ''
                    }`}
                  >
                    <div className='message__meta'>
                      <span>{message.title || message.role}</span>
                      {message.status === 'streaming'
                        ? <span className='message__status'>typing</span>
                        : null}
                      {message.timestamp
                        ? <span>{message.timestamp}</span>
                        : null}
                    </div>
                    <div className='message__bubble'>
                      {message.title &&
                          (message.role === 'system' || message.role === 'tool')
                        ? <div className='message__title'>{message.title}</div>
                        : null}
                      <div className='message__text'>
                        {message.text ||
                          (message.status === 'streaming' ? '...' : '')}
                      </div>
                      {message.toolCalls && message.toolCalls.length
                        ? (
                          <div className='message__tools'>
                            {message.toolCalls.map((tool) => (
                              <span
                                key={tool.id || tool.name}
                                className='tool-chip'
                              >
                                {tool.name}
                              </span>
                            ))}
                          </div>
                        )
                        : null}
                      {message.thinking
                        ? (
                          <details className='message__thinking'>
                            <summary>Reasoning</summary>
                            <pre>{message.thinking}</pre>
                          </details>
                        )
                        : null}
                    </div>
                  </div>
                ))
              )}
          </div>

          <form
            className='composer'
            onSubmit={(event) => {
              event.preventDefault()
              void handleSendPrompt()
            }}
          >
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder='Describe the coding task you want the agent to do...'
            />
            <div className='composer__actions'>
              <span className='composer__hint'>Shift+Enter for new line</span>
              <button
                type='submit'
                className='primary'
                disabled={!prompt.trim()}
              >
                Send
              </button>
            </div>
          </form>
        </div>

        <aside className='panel side'>
          <div className='panel__header'>
            <h2>Activity</h2>
            <button
              type='button'
              className='ghost'
              onClick={clearActivities}
              disabled={state.activities.length === 0}
            >
              Clear
            </button>
          </div>
          <div className='activity'>
            {state.activities.length === 0
              ? (
                <div className='activity__empty'>
                  No tool activity yet.
                </div>
              )
              : (
                state.activities.map((item) => (
                  <div key={item.id} className='activity__card'>
                    <div className='activity__meta'>
                      <span
                        className={`activity__status activity__status--${item.status}`}
                      >
                        {item.status}
                      </span>
                      <span>{item.toolName}</span>
                      <span>{item.updatedAt}</span>
                    </div>
                    {item.output
                      ? (
                        <pre className='activity__output'>
                          {item.output}
                        </pre>
                      )
                      : null}
                  </div>
                ))
              )}
          </div>
          <div className='side__footer'>
            <div className='side__tip'>
              Tip: keep the stream connected so the agent replies land here.
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}
