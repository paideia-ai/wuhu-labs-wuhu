import { useCallback, useEffect, useRef, useState } from 'react'

interface StreamEvent {
  id: string
  type: 'data' | 'heartbeat'
  cursor?: number
  data: unknown
  timestamp: number
}

function App() {
  const [daemonUrl, setDaemonUrl] = useState('')
  const [token, setToken] = useState('')
  const [prompt, setPrompt] = useState('')
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [promptStatus, setPromptStatus] = useState<
    {
      type: 'success' | 'error'
      message: string
    } | null
  >(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const cursorRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token.trim()) {
      headers['Authorization'] = `Bearer ${token.trim()}`
    }
    return headers
  }, [token])

  const parseSSEStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        let currentEventType = ''
        let currentData = ''
        let currentId = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6)
          } else if (line.startsWith('id: ')) {
            currentId = line.slice(4).trim()
          } else if (line === '') {
            // Empty line = end of event
            if (currentData) {
              try {
                const parsed = JSON.parse(currentData)
                if (currentEventType === 'heartbeat') {
                  setEvents((prev) => [
                    ...prev,
                    {
                      id: `heartbeat-${Date.now()}`,
                      type: 'heartbeat',
                      data: parsed,
                      timestamp: Date.now(),
                    },
                  ])
                } else {
                  // Regular data event with envelope { cursor, event }
                  const cursor = parsed.cursor ?? parseInt(currentId) ?? 0
                  cursorRef.current = Math.max(cursorRef.current, cursor)
                  setEvents((prev) => [
                    ...prev,
                    {
                      id: currentId || `event-${cursor}`,
                      type: 'data',
                      cursor,
                      data: parsed,
                      timestamp: Date.now(),
                    },
                  ])
                }
              } catch {
                // Ignore parse errors
              }
            }
            currentEventType = ''
            currentData = ''
            currentId = ''
          }
        }
      }
    },
    [],
  )

  const startStream = useCallback(async () => {
    if (!daemonUrl.trim()) {
      setStreamError('Please enter a daemon URL')
      return
    }

    setIsStreaming(true)
    setStreamError(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const baseUrl = daemonUrl.trim().replace(/\/$/, '')
      const url = `${baseUrl}/stream?cursor=${cursorRef.current}&follow=1`

      const response = await fetch(url, {
        method: 'GET',
        headers: getHeaders(),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      await parseSSEStream(reader)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setStreamError(err.message)
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }, [daemonUrl, getHeaders, parseSSEStream])

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const sendPrompt = useCallback(async () => {
    if (!daemonUrl.trim()) {
      setPromptStatus({ type: 'error', message: 'Please enter a daemon URL' })
      return
    }
    if (!prompt.trim()) {
      setPromptStatus({ type: 'error', message: 'Please enter a prompt' })
      return
    }

    setPromptStatus(null)

    try {
      const baseUrl = daemonUrl.trim().replace(/\/$/, '')
      const response = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ message: prompt.trim() }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setPromptStatus({
          type: 'success',
          message: 'Prompt sent successfully',
        })
        setPrompt('')
      } else {
        setPromptStatus({
          type: 'error',
          message: data.error || `HTTP ${response.status}`,
        })
      }
    } catch (err) {
      setPromptStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send prompt',
      })
    }
  }, [daemonUrl, prompt, getHeaders])

  const clearEvents = useCallback(() => {
    setEvents([])
    cursorRef.current = 0
  }, [])

  return (
    <div className='container'>
      <h1>Sandbox Daemon UI</h1>

      <div className='config-section'>
        <h2>Configuration</h2>
        <div className='config-row'>
          <label htmlFor='daemon-url'>Daemon URL</label>
          <input
            id='daemon-url'
            type='text'
            placeholder='https://your-daemon-url.modal.run'
            value={daemonUrl}
            onChange={(e) => setDaemonUrl(e.target.value)}
          />
        </div>
        <div className='config-row'>
          <label htmlFor='token'>JWT Token (optional for dev mode)</label>
          <input
            id='token'
            type='password'
            placeholder='Bearer token for production'
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </div>

      <div className='prompt-section'>
        <h2>Send Prompt</h2>
        <textarea
          placeholder='Enter your prompt here...'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              sendPrompt()
            }
          }}
        />
        <div className='button-row'>
          <button
            className='primary'
            onClick={sendPrompt}
            disabled={!prompt.trim() || !daemonUrl.trim()}
          >
            Send (Cmd+Enter)
          </button>
        </div>
        {promptStatus && (
          <div
            className={promptStatus.type === 'success'
              ? 'success-message'
              : 'error-message'}
          >
            {promptStatus.message}
          </div>
        )}
      </div>

      <div className='stream-section'>
        <h2>Event Stream</h2>
        <div className='stream-controls'>
          <button
            className='primary'
            onClick={startStream}
            disabled={isStreaming || !daemonUrl.trim()}
          >
            Start Stream
          </button>
          <button
            className='danger'
            onClick={stopStream}
            disabled={!isStreaming}
          >
            Stop
          </button>
          <button className='secondary' onClick={clearEvents}>
            Clear
          </button>
          <span
            className={`stream-status ${
              isStreaming ? 'connected' : 'disconnected'
            }`}
          >
            {isStreaming ? 'Connected' : 'Disconnected'}
            {cursorRef.current > 0 && ` (cursor: ${cursorRef.current})`}
          </span>
        </div>
        {streamError && <div className='error-message'>{streamError}</div>}
        <div className='stream-log'>
          {events.length === 0 && (
            <div style={{ color: '#666', padding: '1rem' }}>
              No events yet. Click "Start Stream" to begin receiving events.
            </div>
          )}
          {events.map((event) => (
            <div
              key={event.id}
              className={`stream-log-entry ${
                event.type === 'heartbeat' ? 'heartbeat' : ''
              }`}
            >
              {event.type === 'heartbeat' ? <span>heartbeat</span> : (
                <>
                  <span className='cursor'>[{event.cursor}]</span>
                  <span className='event-type'>
                    {(event.data as { event?: { type?: string } })?.event
                      ?.type ||
                      'unknown'}
                  </span>
                  <span>{JSON.stringify(event.data, null, 2)}</span>
                </>
              )}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}

export default App
