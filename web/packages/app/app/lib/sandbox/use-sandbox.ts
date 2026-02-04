import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type {
  CodingUiState,
  ControlUiState,
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

type CodingAction =
  | { type: 'RESET'; state: CodingUiState }
  | { type: 'ENVELOPE'; envelope: StreamEnvelope<SandboxDaemonEvent> }

type ControlAction =
  | { type: 'RESET'; state: ControlUiState }
  | { type: 'ENVELOPE'; envelope: StreamEnvelope<SandboxControlEvent> }

function codingReducer(
  state: CodingUiState,
  action: CodingAction,
): CodingUiState {
  if (action.type === 'RESET') return action.state
  return reduceCodingEnvelope(state, action.envelope)
}

function controlReducer(
  state: ControlUiState,
  action: ControlAction,
): ControlUiState {
  if (action.type === 'RESET') return action.state
  return reduceControlEnvelope(state, action.envelope)
}

function nextReconnectDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.min(attempt, 6), 15_000)
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}

export type SandboxStreamsOptions = {
  initialCodingState?: CodingUiState
  initialControlState?: ControlUiState
  reconnect?: boolean
}

export function useSandboxStreams(
  id: string,
  options: SandboxStreamsOptions = {},
) {
  const reconnect = options.reconnect ?? false
  const initialCoding = options.initialCodingState ?? initialCodingUiState
  const initialControl = options.initialControlState ?? initialControlUiState

  const [coding, dispatchCoding] = useReducer(codingReducer, initialCoding)
  const [control, dispatchControl] = useReducer(controlReducer, initialControl)

  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const abortRef = useRef<AbortController | null>(null)
  const codingCursorRef = useRef<number>(initialCoding.cursor)
  const controlCursorRef = useRef<number>(initialControl.cursor)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const start = useCallback(() => {
    if (!id) return
    stop()
    const controller = new AbortController()
    abortRef.current = controller
    setConnectionStatus('Connecting...')

    const runStream = async (
      streamName: 'control' | 'coding',
      url: () => string,
      onEnvelope: (env: StreamEnvelope<unknown>) => boolean | void,
      cursorRef: { current: number },
    ) => {
      let attempt = 0
      while (!controller.signal.aborted) {
        try {
          const res = await fetch(url(), {
            method: 'GET',
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
          })
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '')
            throw new Error(`stream_failed (${res.status}): ${text}`)
          }

          attempt = 0

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (!controller.signal.aborted) {
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
              if (!env) continue
              if (env.cursor <= cursorRef.current) continue
              const processed = onEnvelope(env)
              if (processed === false) continue
              cursorRef.current = env.cursor
            }
          }
        } catch (err) {
          if (controller.signal.aborted) break
          if (!isAbortError(err)) {
            console.error(`${streamName} SSE stream error`, err)
          }
        }

        if (!reconnect) break
        attempt += 1
        const delay = nextReconnectDelayMs(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    const controlUrl = () =>
      `/api/sandboxes/${
        encodeURIComponent(id)
      }/stream/control?cursor=${controlCursorRef.current}`
    const codingUrl = () =>
      `/api/sandboxes/${
        encodeURIComponent(id)
      }/stream/coding?cursor=${codingCursorRef.current}`
    ;(async () => {
      try {
        setConnectionStatus('Connected')
        await Promise.all([
          runStream(
            'control',
            controlUrl,
            (env) =>
              dispatchControl({
                type: 'ENVELOPE',
                envelope: env as StreamEnvelope<SandboxControlEvent>,
              }),
            controlCursorRef,
          ),
          runStream(
            'coding',
            codingUrl,
            (env) => {
              const coerced = coerceCodingEnvelope(env)
              if (!coerced) return false
              dispatchCoding({ type: 'ENVELOPE', envelope: coerced })
            },
            codingCursorRef,
          ),
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
  }, [id, reconnect, stop])

  useEffect(() => {
    codingCursorRef.current = initialCoding.cursor
    controlCursorRef.current = initialControl.cursor
    dispatchCoding({ type: 'RESET', state: initialCoding })
    dispatchControl({ type: 'RESET', state: initialControl })
    start()
    return () => stop()
  }, [id, initialCoding, initialControl, start])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (!reconnect) return
      if (
        connectionStatus === 'Disconnected' ||
        connectionStatus === 'Stream error'
      ) {
        start()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    globalThis.addEventListener('focus', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      globalThis.removeEventListener('focus', onVisibility)
    }
  }, [connectionStatus, reconnect, start])

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
