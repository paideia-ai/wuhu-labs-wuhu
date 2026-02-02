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

function formatTimestamp(value) {
  const now = value ? new Date(value) : new Date()
  return now.toLocaleTimeString([], { hour12: false })
}

function extractMessageParts(message) {
  const parts = { text: '', thinking: '', toolCalls: [] }
  if (!message) return parts
  const { content } = message
  if (typeof content === 'string') {
    parts.text = content
    return parts
  }
  if (Array.isArray(content)) {
    const toolCallById = new Map()
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'text' && typeof item.text === 'string') {
        parts.text += item.text
      }
      if (item.type === 'thinking' && typeof item.thinking === 'string') {
        parts.thinking += item.thinking
      }
      if (item.type === 'toolCall') {
        const id = typeof item.id === 'string' ? item.id : ''
        if (id) {
          toolCallById.set(id, item)
        } else {
          parts.toolCalls.push(item)
        }
      }
    }
    if (toolCallById.size) {
      parts.toolCalls.push(...toolCallById.values())
    }
  }
  return parts
}

function extractToolOutput(result) {
  if (!result) return ''
  if (typeof result === 'string') return result
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (!item || typeof item !== 'object') return ''
      if (item.type === 'text') return item.text || ''
      return ''
    }).join('')
  }
  if (typeof result === 'object') {
    if (Array.isArray(result.content)) {
      return result.content
        .map((item) => (item?.type === 'text' ? item.text || '' : ''))
        .join('')
    }
    if (typeof result.output === 'string') return result.output
    if (typeof result.message === 'string') return result.message
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return ''
    }
  }
  return ''
}

function formatDaemonEvent(event) {
  if (!event || typeof event !== 'object') return null
  switch (event.type) {
    case 'repo_cloned':
      return {
        title: 'Repo cloned',
        text: `Repo ${event.repoId} is ready at ${event.path}.`,
      }
    case 'repo_clone_error':
      return {
        title: 'Repo clone failed',
        text: `Repo ${event.repoId} failed to clone. ${event.error || ''}`
          .trim(),
      }
    case 'checkpoint_commit':
      return {
        title: 'Checkpoint commit',
        text:
          `Turn ${event.turn} committed on ${event.branch} (${event.commitSha}).`,
      }
    default:
      return {
        title: 'Daemon event',
        text: JSON.stringify(event),
      }
  }
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
  const [messages, setMessages] = useState([])
  const [activities, setActivities] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const [agentStatus, setAgentStatus] = useState('Idle')
  const [lastEvent, setLastEvent] = useState('')
  const [streaming, setStreaming] = useState(false)

  const streamAbortRef = useRef(null)
  const logRef = useRef(null)
  const messageIdRef = useRef(0)
  const pendingUserQueueRef = useRef([])
  const streamingAssistantRef = useRef(null)
  const cursorRef = useRef(0)
  const messageCountRef = useRef(0)

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BASE, baseUrl)
  }, [baseUrl])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TOKEN, token)
  }, [token])

  useEffect(() => {
    if (!logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    messageCountRef.current = messages.length
  }, [messages.length])

  useEffect(() => {
    if (streaming) {
      stopStream()
    }
  }, [baseUrl, token])

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

  const createMessageId = () => {
    messageIdRef.current += 1
    return `msg-${Date.now()}-${messageIdRef.current}`
  }

  const appendMessage = (message) => {
    setMessages((prev) => {
      if (message?.id && prev.some((item) => item.id === message.id)) {
        return prev
      }
      const next = [...prev, message]
      return next.length > 300 ? next.slice(next.length - 300) : next
    })
  }

  const updateMessage = (id, updates) => {
    setMessages((prev) => {
      const next = [...prev]
      const idx = next.findIndex((item) => item.id === id)
      if (idx === -1) return prev
      next[idx] = { ...next[idx], ...updates }
      return next
    })
  }

  const addSystemMessage = (title, text) => {
    appendMessage({
      id: createMessageId(),
      role: 'system',
      title,
      text,
      timestamp: formatTimestamp(),
      status: 'complete',
    })
  }

  const ensureStreamingAssistant = (message, updates) => {
    setMessages((prev) => {
      const next = [...prev]
      let idx = -1
      if (streamingAssistantRef.current) {
        idx = next.findIndex((item) =>
          item.id === streamingAssistantRef.current
        )
      }
      if (idx === -1) {
        const newId = createMessageId()
        streamingAssistantRef.current = newId
        next.push({
          id: newId,
          role: 'assistant',
          title: 'Agent',
          text: '',
          thinking: '',
          toolCalls: [],
          timestamp: formatTimestamp(message?.timestamp),
          status: 'streaming',
        })
        idx = next.length - 1
      }
      next[idx] = { ...next[idx], ...updates }
      return next
    })
  }

  const finalizeStreamingAssistant = () => {
    const id = streamingAssistantRef.current
    if (!id) return
    streamingAssistantRef.current = null

    setMessages((prev) => {
      const next = [...prev]
      const idx = next.findIndex((item) => item.id === id)
      if (idx === -1) return prev
      const message = next[idx]
      const empty = !String(message.text || '').trim() &&
        !String(message.thinking || '').trim() &&
        (!message.toolCalls || message.toolCalls.length === 0)
      if (empty) {
        next.splice(idx, 1)
        return next
      }
      next[idx] = { ...message, status: 'complete' }
      return next
    })
  }

  const reconcileUserMessage = (text, timestamp) => {
    setMessages((prev) => {
      const next = [...prev]
      const queue = pendingUserQueueRef.current
      const pendingIndex = queue.findIndex((item) => item.text === text)
      if (pendingIndex !== -1) {
        const pending = queue.splice(pendingIndex, 1)[0]
        const idx = next.findIndex((item) => item.id === pending.id)
        if (idx !== -1) {
          next[idx] = {
            ...next[idx],
            status: 'sent',
            timestamp: formatTimestamp(timestamp),
          }
          return next
        }
        next.push({
          id: pending.id,
          role: 'user',
          title: 'You',
          text: pending.text,
          timestamp: formatTimestamp(timestamp),
          status: 'sent',
        })
        return next
      }
      const fallbackIndex = [...next]
        .reverse()
        .findIndex((item) => item.role === 'user' && item.text === text)
      if (fallbackIndex !== -1) {
        const idx = next.length - 1 - fallbackIndex
        next[idx] = {
          ...next[idx],
          status: 'sent',
          timestamp: formatTimestamp(timestamp),
        }
        return next
      }
      next.push({
        id: createMessageId(),
        role: 'user',
        title: 'You',
        text,
        timestamp: formatTimestamp(timestamp),
        status: 'sent',
      })
      return next
    })
  }

  const handleAgentMessage = (message, phase) => {
    if (!message || typeof message !== 'object') return
    const role = message.role || 'assistant'
    const { text, thinking, toolCalls } = extractMessageParts(message)
    const timestamp = message.timestamp || Date.now()

    if (role === 'assistant') {
      ensureStreamingAssistant(message, {
        text,
        thinking,
        toolCalls,
        timestamp: formatTimestamp(timestamp),
        status: phase === 'message_end' ? 'complete' : 'streaming',
      })
      if (phase === 'message_end') {
        streamingAssistantRef.current = null
      }
      return
    }

    if (role === 'user') {
      reconcileUserMessage(text, timestamp)
      return
    }

    if (role === 'toolResult') {
      if (phase !== 'message_end') return
      const toolCallId = typeof message.toolCallId === 'string'
        ? message.toolCallId
        : ''
      const toolMessageId = toolCallId ? `tool-${toolCallId}` : createMessageId()
      const updates = {
        id: toolMessageId,
        role: 'tool',
        title: message.toolName || 'Tool result',
        text: text || '',
        timestamp: formatTimestamp(timestamp),
        status: message.isError ? 'error' : 'complete',
        toolName: message.toolName,
      }
      setMessages((prev) => {
        const next = [...prev]
        const idx = next.findIndex((item) => item.id === toolMessageId)
        if (idx === -1) {
          return [...next, updates]
        }
        next[idx] = { ...next[idx], ...updates }
        return next
      })
      return
    }

    appendMessage({
      id: createMessageId(),
      role: 'system',
      title: role,
      text: text || JSON.stringify(message),
      timestamp: formatTimestamp(timestamp),
      status: 'complete',
    })
  }

  const updateActivity = (event) => {
    const toolCallId = event.toolCallId || createMessageId()
    const toolName = event.toolName || 'tool'
    const output = extractToolOutput(event.partialResult || event.result)
    const timestamp = formatTimestamp()
    const status = event.type === 'tool_execution_end'
      ? (event.isError ? 'error' : 'done')
      : 'running'

    setActivities((prev) => {
      const next = [...prev]
      const idx = next.findIndex((item) => item.id === toolCallId)
      if (idx === -1) {
        next.unshift({
          id: toolCallId,
          toolName,
          status,
          output,
          updatedAt: timestamp,
        })
      } else {
        next[idx] = {
          ...next[idx],
          status,
          output: output || next[idx].output,
          updatedAt: timestamp,
        }
      }
      return next.slice(0, 12)
    })
  }

  const handleAgentEvent = (event) => {
    if (!event || typeof event !== 'object') return
    if (typeof event.type === 'string') {
      setLastEvent(event.type)
    }

    switch (event.type) {
      case 'turn_start':
        finalizeStreamingAssistant()
        return
      case 'message_start':
      case 'message_update':
      case 'message_end':
        handleAgentMessage(event.message, event.type)
        if (event.message?.role === 'assistant') {
          setAgentStatus(event.type === 'message_end' ? 'Idle' : 'Responding')
        }
        return
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        updateActivity(event)
        setAgentStatus(
          event.type === 'tool_execution_end'
            ? 'Idle'
            : `Running ${event.toolName || 'tool'}`,
        )
        return
      case 'agent_end':
        finalizeStreamingAssistant()
        setAgentStatus('Idle')
        if (messageCountRef.current === 0 && Array.isArray(event.messages)) {
          for (const msg of event.messages) {
            handleAgentMessage(msg, 'message_end')
          }
        }
        return
      case 'turn_end':
        finalizeStreamingAssistant()
        setAgentStatus('Idle')
        if (messageCountRef.current === 0 && event.message) {
          handleAgentMessage(event.message, 'message_end')
        }
        if (messageCountRef.current === 0 && Array.isArray(event.toolResults)) {
          for (const result of event.toolResults) {
            handleAgentMessage(result, 'message_end')
          }
        }
        return
      default:
        return
    }
  }

  const handleDaemonEvent = (event) => {
    const formatted = formatDaemonEvent(event)
    if (formatted) {
      addSystemMessage(formatted.title, formatted.text)
    }
    if (event?.type) {
      setLastEvent(event.type)
    }
  }

  const handleEnvelope = (payload) => {
    if (!payload || typeof payload !== 'object') return
    if (typeof payload.cursor === 'number') {
      setCursor(payload.cursor)
    }
    const event = payload.event
    if (!event || typeof event !== 'object') return
    if (event.source === 'agent') {
      handleAgentEvent(event.payload)
      return
    }
    if (event.source === 'daemon') {
      handleDaemonEvent(event)
    }
  }

  const handleSendPrompt = async () => {
    if (!baseUrl) {
      setConnectionStatus('Missing daemon URL')
      return
    }
    const text = prompt.trim()
    if (!text) return

    if (!streaming) {
      void startStream()
    }

    const localId = createMessageId()
    pendingUserQueueRef.current.push({ id: localId, text })
    appendMessage({
      id: localId,
      role: 'user',
      title: 'You',
      text,
      timestamp: formatTimestamp(),
      status: 'pending',
    })

    setPrompt('')
    setAgentStatus('Queued')

    try {
      const res = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Prompt failed (${res.status}): ${errorText}`)
      }
      updateMessage(localId, { status: 'sent' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateMessage(localId, { status: 'error' })
      pendingUserQueueRef.current = pendingUserQueueRef.current.filter(
        (item) => item.id !== localId,
      )
      addSystemMessage('Prompt error', message || 'Prompt failed.')
      setAgentStatus('Idle')
    }
  }

  const handleAbort = async () => {
    if (!baseUrl) return
    setAgentStatus('Stopping')
    try {
      const res = await fetch(`${baseUrl}/abort`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'user_abort' }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Abort failed (${res.status}): ${errorText}`)
      }
      addSystemMessage('Abort requested', 'The agent was asked to stop.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addSystemMessage('Abort failed', message || 'Abort failed.')
    } finally {
      setAgentStatus('Idle')
    }
  }

  const startStream = async () => {
    if (streaming) return
    if (!baseUrl) {
      setConnectionStatus('Missing daemon URL')
      return
    }
    setConnectionStatus('Connecting...')
    setStreaming(true)
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      const res = await fetch(
        `${baseUrl}/stream?cursor=${cursorRef.current}&follow=1`,
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

          let parsedJson = null
          try {
            parsedJson = JSON.parse(parsed.data)
          } catch {
            parsedJson = null
          }

          if (parsedJson) {
            handleEnvelope(parsedJson)
          }
        }
      }
    } catch (err) {
      const isAbort = err && typeof err === 'object' &&
        err.name === 'AbortError'
      if (!isAbort) {
        const message = err instanceof Error ? err.message : String(err)
        addSystemMessage('Stream error', message || 'Stream error.')
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

  const clearConversation = () => {
    setMessages([])
    setActivities([])
    setCursor(0)
    cursorRef.current = 0
    setLastEvent('')
    setAgentStatus('Idle')
  }

  const handlePromptKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendPrompt()
    }
  }

  return (
    <div className='app'>
      <header className='hero'>
        <div className='hero__text'>
          <p className='eyebrow'>Wuhu Sandbox</p>
          <h1>Agent Workbench</h1>
          <p className='subtext'>
            Connect to a sandbox daemon, give the agent a task, and watch it
            respond in real time.
          </p>
        </div>
        <div className='status'>
          <div className='status__label'>Connection</div>
          <div className='status__value'>{connectionStatus}</div>
          <div className='status__meta'>Agent: {agentStatus}</div>
          <div className='status__meta'>Cursor: {cursor}</div>
          <div className='status__meta'>Last event: {lastEvent || 'None'}</div>
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
          <p className='helper'>
            Status: {connectionStatus}
          </p>
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
                disabled={!baseUrl}
              >
                Abort
              </button>
              <button type='button' onClick={clearConversation}>
                Clear
              </button>
            </div>
          </div>

          <div className='chat__log' ref={logRef}>
            {messages.length === 0
              ? (
                <div className='chat__empty'>
                  No messages yet. Connect to the daemon and send a prompt.
                </div>
              )
              : (
                messages.map((message) => (
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
              handleSendPrompt()
            }}
          >
            <textarea
              rows='3'
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
                disabled={!prompt.trim() || !baseUrl}
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
              onClick={() => setActivities([])}
              disabled={activities.length === 0}
            >
              Clear
            </button>
          </div>
          <div className='activity'>
            {activities.length === 0
              ? (
                <div className='activity__empty'>
                  No tool activity yet.
                </div>
              )
              : (
                activities.map((item) => (
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
