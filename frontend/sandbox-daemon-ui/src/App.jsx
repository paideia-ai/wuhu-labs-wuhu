import React, { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY_BASE = 'sandbox-daemon-ui.baseUrl'
const STORAGE_KEY_TOKEN = 'sandbox-daemon-ui.jwt'

function normalizeBaseUrl(value) {
  if (!value) return ''
  return value.replace(/\/+$/, '')
}

function parseSseChunk(chunk) {
  const lines = chunk.split(/\r?\n/)
  const dataLines = []
  let eventName = ''
  let id = ''

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  const data = dataLines.join('\n')
  return { eventName: eventName || 'message', id, data }
}

function formatTimestamp() {
  const now = new Date()
  return now.toLocaleTimeString([], { hour12: false })
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(() =>
    normalizeBaseUrl(localStorage.getItem(STORAGE_KEY_BASE) || '')
  )
  const [token, setToken] = useState(() =>
    localStorage.getItem(STORAGE_KEY_TOKEN) || ''
  )
  const [prompt, setPrompt] = useState('')
  const [cursor, setCursor] = useState(0)
  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('')
  const [streaming, setStreaming] = useState(false)
  const streamAbortRef = useRef(null)
  const logRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BASE, baseUrl)
  }, [baseUrl])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TOKEN, token)
  }, [token])

  useEffect(() => {
    if (!logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [events])

  const headers = useMemo(() => {
    const result = { 'content-type': 'application/json' }
    if (token.trim()) {
      result.authorization = `Bearer ${token.trim()}`
    }
    return result
  }, [token])

  const streamHeaders = useMemo(() => {
    const result = {}
    if (token.trim()) {
      result.authorization = `Bearer ${token.trim()}`
    }
    return result
  }, [token])

  const appendEvent = (entry) => {
    setEvents((prev) => {
      const next = [...prev, entry]
      return next.length > 500 ? next.slice(next.length - 500) : next
    })
  }

  const handleSendPrompt = async () => {
    if (!baseUrl) {
      setStatus('Set the daemon base URL first.')
      return
    }
    if (!prompt.trim()) return
    setStatus('Sending prompt...')
    try {
      const res = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: prompt.trim() }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Prompt failed (${res.status}): ${text}`)
      }
      setPrompt('')
      setStatus('Prompt sent.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(message || 'Prompt failed.')
    }
  }

  const startStream = async () => {
    if (streaming) return
    if (!baseUrl) {
      setStatus('Set the daemon base URL first.')
      return
    }
    setStatus('Connecting to stream...')
    setStreaming(true)
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      const res = await fetch(
        `${baseUrl}/stream?cursor=${cursor}&follow=1`,
        {
          method: 'GET',
          headers: streamHeaders,
          signal: controller.signal,
        },
      )
      if (!res.ok || !res.body) {
        const text = await res.text()
        throw new Error(`Stream failed (${res.status}): ${text}`)
      }

      setStatus('Streaming...')
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

          const payload = parsed.data
          let parsedJson = null
          try {
            parsedJson = JSON.parse(parsed.data)
          } catch {
            parsedJson = null
          }

          if (parsedJson && typeof parsedJson.cursor === 'number') {
            setCursor(parsedJson.cursor)
          }

          appendEvent({
            ts: formatTimestamp(),
            event: parsed.eventName,
            id: parsed.id,
            raw: payload,
            json: parsedJson,
          })
        }
      }
    } catch (err) {
      const isAbort = err && typeof err === 'object' &&
        err.name === 'AbortError'
      if (isAbort) {
        setStatus('Stream stopped.')
      } else {
        const message = err instanceof Error ? err.message : String(err)
        setStatus(message || 'Stream error.')
      }
    } finally {
      setStreaming(false)
      streamAbortRef.current = null
    }
  }

  const stopStream = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
    }
  }

  return (
    <div className='app'>
      <header className='hero'>
        <div className='hero__text'>
          <p className='eyebrow'>Wuhu Sandbox</p>
          <h1>Daemon Stream Console</h1>
          <p className='subtext'>
            Paste the sandbox daemon URL, stream events, and fire prompts
            without any backend.
          </p>
        </div>
        <div className='status'>
          <div className='status__label'>Status</div>
          <div className='status__value'>{status || 'Idle'}</div>
          <div className='status__meta'>Cursor: {cursor}</div>
        </div>
      </header>

      <section className='panel grid'>
        <div className='panel__block'>
          <label htmlFor='base-url'>Daemon base URL</label>
          <input
            id='base-url'
            type='url'
            placeholder='https://xxxx.modal.host'
            value={baseUrl}
            onChange={(e) => setBaseUrl(normalizeBaseUrl(e.target.value))}
          />
        </div>
        <div className='panel__block'>
          <label htmlFor='token'>JWT (optional)</label>
          <input
            id='token'
            type='password'
            placeholder='Bearer token for production'
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </section>

      <section className='panel'>
        <div className='panel__header'>
          <h2>Prompt</h2>
          <button type='button' className='primary' onClick={handleSendPrompt}>
            Send
          </button>
        </div>
        <textarea
          rows='4'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Ask the agent to do something...'
        />
      </section>

      <section className='panel'>
        <div className='panel__header'>
          <h2>Stream</h2>
          <div className='controls'>
            <button type='button' onClick={startStream} disabled={streaming}>
              Start
            </button>
            <button
              type='button'
              className='ghost'
              onClick={stopStream}
              disabled={!streaming}
            >
              Stop
            </button>
          </div>
        </div>
        <div className='log' ref={logRef}>
          {events.length === 0
            ? <div className='log__empty'>No events yet. Start the stream.</div>
            : (
              events.map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className='log__entry'>
                  <div className='log__meta'>
                    <span>{entry.ts}</span>
                    <span>{entry.event}</span>
                    {entry.id ? <span>id:{entry.id}</span> : null}
                  </div>
                  <pre>
                  {entry.json
                    ? JSON.stringify(entry.json, null, 2)
                    : entry.raw}
                  </pre>
                </div>
              ))
            )}
        </div>
      </section>
    </div>
  )
}
