import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type {
  SandboxControlEvent,
  SandboxDaemonAgentEventPayload,
  SandboxDaemonEvent,
  StreamEnvelope,
} from './types.ts'
import { initialCodingUiState, initialControlUiState } from './types.ts'
import { reduceCodingEnvelope, reduceControlEnvelope } from './reducer.ts'

function parseSseChunk(chunk: string): { id?: string; data?: string } {
  const lines = chunk.split(/\r?\n/)
  const dataLines: string[] = []
  let id: string | undefined

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseEnvelope(data: string): StreamEnvelope<unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const cursor = parsed.cursor
  if (typeof cursor !== 'number') return null
  if (!('event' in parsed)) return null
  return { cursor, event: parsed.event }
}

function coerceCodingEnvelope(
  raw: StreamEnvelope<unknown>,
): StreamEnvelope<SandboxDaemonEvent> | null {
  const event = raw.event
  if (!event || typeof event !== 'object') return null

  if (isRecord(event) && typeof event.source === 'string') {
    return { cursor: raw.cursor, event: event as SandboxDaemonEvent }
  }

  // Core stream/coding returns the agent payload directly; wrap it to match reducer.
  const payload = isRecord(event) ? event : {}
  const type = typeof payload.type === 'string' ? payload.type : 'unknown'
  const agentPayload: SandboxDaemonAgentEventPayload = { ...payload, type }
  return {
    cursor: raw.cursor,
    event: {
      source: 'agent',
      type,
      payload: agentPayload,
    },
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  if (!isRecord(err)) return false
  return err.name === 'AbortError'
}

export function useSandboxStreams(id: string) {
  const [coding, dispatchCoding] = useReducer(
    reduceCodingEnvelope,
    initialCodingUiState,
  )

  const [control, dispatchControl] = useReducer(
    reduceControlEnvelope,
    initialControlUiState,
  )

  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const abortRef = useRef<AbortController | null>(null)

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
  }

  const start = () => {
    if (!id) return
    stop()
    const controller = new AbortController()
    abortRef.current = controller
    setConnectionStatus('Connecting...')

    const runStream = async (
      url: string,
      onEnvelope: (env: StreamEnvelope<unknown>) => void,
    ) => {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(`stream_failed (${res.status}): ${text}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split(/\r?\n\r?\n/)
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue
          const parsed = parseSseChunk(part)
          if (!parsed.data) continue
          const env = parseEnvelope(parsed.data)
          if (env) onEnvelope(env)
        }
      }
    }

    const controlUrl = `/api/sandboxes/${
      encodeURIComponent(id)
    }/stream/control?cursor=${control.cursor}`
    const codingUrl = `/api/sandboxes/${
      encodeURIComponent(id)
    }/stream/coding?cursor=${coding.cursor}`
    ;(async () => {
      try {
        setConnectionStatus('Connected')
        await Promise.all([
          runStream(
            controlUrl,
            (env) =>
              dispatchControl(env as StreamEnvelope<SandboxControlEvent>),
          ),
          runStream(codingUrl, (env) => {
            const coerced = coerceCodingEnvelope(env)
            if (coerced) dispatchCoding(coerced)
          }),
        ])
      } catch (err) {
        if (!isAbortError(err)) {
          console.error('SSE stream error', err)
          setConnectionStatus('Stream error')
        }
      } finally {
        if (!controller.signal.aborted) {
          setConnectionStatus('Disconnected')
        }
      }
    })()
  }

  useEffect(() => {
    start()
    return () => stop()
  }, [id])

  const api = useMemo(() => {
    return {
      coding,
      control,
      connectionStatus,
      start,
      stop,
    }
  }, [coding, control, connectionStatus])

  return api
}

export async function sendSandboxPrompt(options: {
  sandboxId: string
  message: string
  streamingBehavior?: 'steer' | 'followUp'
}): Promise<void> {
  const message = options.message.trim()
  if (!message) return
  const res = await fetch(`/api/sandboxes/${options.sandboxId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      streamingBehavior: options.streamingBehavior ?? 'followUp',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`prompt_failed (${res.status}): ${text}`)
  }
}

export async function abortSandbox(options: {
  sandboxId: string
  reason?: string
}): Promise<void> {
  const res = await fetch(`/api/sandboxes/${options.sandboxId}/abort`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: options.reason ?? 'user_abort' }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`abort_failed (${res.status}): ${text}`)
  }
}
