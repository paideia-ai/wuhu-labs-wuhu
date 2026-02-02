import { useEffect, useMemo, useRef, useState } from 'react'
import { parseEventStream } from './sse'

type LogEntry =
  | { kind: 'info'; ts: number; message: string }
  | { kind: 'event'; ts: number; raw: string }
  | { kind: 'error'; ts: number; message: string }

function nowTs(): number {
  return Date.now()
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function readQueryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

const LS_BASE_URL = 'wuhu.sandboxDaemonUi.baseUrl'
const LS_TOKEN = 'wuhu.sandboxDaemonUi.token'

export default function App() {
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [prompt, setPrompt] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [streaming, setStreaming] = useState(false)
  const [cursor, setCursor] = useState(0)

  const cursorRef = useRef(0)
  const stopRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const daemonFromQuery = readQueryParam('daemon')
    const baseFromStorage = localStorage.getItem(LS_BASE_URL) ?? ''
    const tokenFromStorage = localStorage.getItem(LS_TOKEN) ?? ''

    const initialBase = daemonFromQuery?.trim() || baseFromStorage.trim()
    if (initialBase) setBaseUrl(initialBase)
    if (tokenFromStorage.trim()) setToken(tokenFromStorage)
  }, [])

  useEffect(() => {
    localStorage.setItem(LS_BASE_URL, baseUrl)
  }, [baseUrl])

  useEffect(() => {
    localStorage.setItem(LS_TOKEN, token)
  }, [token])

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  const authHeaders = useMemo(() => {
    const t = token.trim()
    if (!t) return {}
    return { authorization: `Bearer ${t}` }
  }, [token])

  const logRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  const pushLog = (entry: LogEntry) => {
    setLogs((prev) => {
      const next = prev.length > 500 ? prev.slice(prev.length - 500) : prev
      return [...next, entry]
    })
  }

  const doPrompt = async () => {
    const url = normalizeBaseUrl(baseUrl)
    if (!url) {
      pushLog({
        kind: 'error',
        ts: nowTs(),
        message: 'Missing daemon base URL',
      })
      return
    }
    const message = prompt.trim()
    if (!message) return

    pushLog({ kind: 'info', ts: nowTs(), message: `POST ${url}/prompt` })
    try {
      const res = await fetch(`${url}/prompt`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message }),
      })
      const text = await res.text()
      if (!res.ok) {
        pushLog({
          kind: 'error',
          ts: nowTs(),
          message: `Prompt failed (${res.status}): ${text || res.statusText}`,
        })
        return
      }
      pushLog({
        kind: 'info',
        ts: nowTs(),
        message: `Prompt ok (${res.status}): ${text}`,
      })
      setPrompt('')
    } catch (e) {
      pushLog({
        kind: 'error',
        ts: nowTs(),
        message: `Prompt error: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  const startStream = async () => {
    const url = normalizeBaseUrl(baseUrl)
    if (!url) {
      pushLog({
        kind: 'error',
        ts: nowTs(),
        message: 'Missing daemon base URL',
      })
      return
    }
    if (streaming) return

    const controller = new AbortController()
    stopRef.current = controller
    setStreaming(true)

    const startCursor = cursorRef.current || 0
    const streamUrl = `${url}/stream?cursor=${startCursor}&follow=1`
    pushLog({ kind: 'info', ts: nowTs(), message: `GET ${streamUrl}` })

    try {
      const res = await fetch(streamUrl, {
        method: 'GET',
        headers: {
          ...authHeaders,
          accept: 'text/event-stream',
        },
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text()
        pushLog({
          kind: 'error',
          ts: nowTs(),
          message: `Stream failed (${res.status}): ${text || res.statusText}`,
        })
        return
      }

      for await (const msg of parseEventStream(res, controller.signal)) {
        pushLog({ kind: 'event', ts: nowTs(), raw: msg.data })
        try {
          const parsed = JSON.parse(msg.data) as { cursor?: number }
          if (
            typeof parsed.cursor === 'number' && Number.isFinite(parsed.cursor)
          ) {
            setCursor(parsed.cursor)
          } else if (msg.id) {
            const fromId = Number(msg.id)
            if (Number.isFinite(fromId)) setCursor(fromId)
          }
        } catch {
          if (msg.id) {
            const fromId = Number(msg.id)
            if (Number.isFinite(fromId)) setCursor(fromId)
          }
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return
      pushLog({
        kind: 'error',
        ts: nowTs(),
        message: `Stream error: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      stopRef.current = null
      setStreaming(false)
    }
  }

  const stopStream = () => {
    stopRef.current?.abort()
    stopRef.current = null
    setStreaming(false)
    pushLog({ kind: 'info', ts: nowTs(), message: 'Stream stopped' })
  }

  return (
    <div className='page'>
      <header className='header'>
        <div className='title'>Sandbox Daemon UI</div>
        <div className='subtitle'>
          Browser connects directly to the daemon via streaming fetch (SSE)
        </div>
      </header>

      <section className='panel'>
        <div className='panelTitle'>Config</div>
        <div className='grid2'>
          <label className='field'>
            <div className='label'>Daemon base URL</div>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder='https://... (Modal tunnel URL)'
              spellCheck={false}
            />
          </label>
          <label className='field'>
            <div className='label'>JWT (optional)</div>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder='Bearer token (admin or user)'
              spellCheck={false}
            />
          </label>
        </div>
        <div className='row'>
          <div className='pill'>cursor: {cursor}</div>
          <div className={`pill ${streaming ? 'ok' : ''}`}>
            stream: {streaming ? 'running' : 'stopped'}
          </div>
        </div>
      </section>

      <section className='panel'>
        <div className='panelTitle'>Prompt</div>
        <textarea
          className='textarea'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Type a prompt...'
        />
        <div className='row'>
          <button type='button' className='btn' onClick={() => void doPrompt()}>
            Send
          </button>
        </div>
      </section>

      <section className='panel'>
        <div className='panelTitle'>Stream</div>
        <div className='row'>
          <button
            type='button'
            className='btn'
            onClick={() => void startStream()}
            disabled={streaming}
          >
            Start Stream
          </button>
          <button
            type='button'
            className='btn'
            onClick={stopStream}
            disabled={!streaming}
          >
            Stop
          </button>
        </div>
      </section>

      <section className='panel'>
        <div className='panelTitle'>Log</div>
        <div className='log' ref={logRef}>
          {logs.map((l, idx) => {
            if (l.kind === 'event') {
              return (
                <div key={idx} className='logLine'>
                  <span className='ts'>
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span className='tag event'>event</span>
                  <span className='mono'>{l.raw}</span>
                </div>
              )
            }
            if (l.kind === 'error') {
              return (
                <div key={idx} className='logLine'>
                  <span className='ts'>
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span className='tag err'>error</span>
                  <span>{l.message}</span>
                </div>
              )
            }
            return (
              <div key={idx} className='logLine'>
                <span className='ts'>
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <span className='tag info'>info</span>
                <span>{l.message}</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
