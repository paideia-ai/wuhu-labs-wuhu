import type { SandboxDaemonAgentEvent } from './types.ts'

export type PersistedUiMessageRole = 'user' | 'assistant' | 'tool'

export interface PersistedUiMessage {
  cursor: number
  role: PersistedUiMessageRole
  content: string
  toolName?: string
  toolCallId?: string
  turnIndex: number
}

export interface CursorStore {
  get(): number
  set(next: number): void
  save(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readIntField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isInteger(value)) return value
  return 0
}

export class FileCursorStore implements CursorStore {
  #path: string
  #cursor: number

  constructor(path: string) {
    this.#path = path
    this.#cursor = 0
    this.#cursor = this.#load()
  }

  get(): number {
    return this.#cursor
  }

  set(next: number): void {
    if (!Number.isFinite(next)) return
    const value = Math.max(0, Math.floor(next))
    this.#cursor = value
  }

  save(): void {
    try {
      const idx = this.#path.lastIndexOf('/')
      if (idx > 0) {
        const dir = this.#path.slice(0, idx)
        Deno.mkdirSync(dir, { recursive: true })
      }
      Deno.writeTextFileSync(
        this.#path,
        JSON.stringify({ cursor: this.#cursor, updatedAt: Date.now() }),
      )
    } catch {
      // Best-effort; failure should not break the daemon.
    }
  }

  #load(): number {
    try {
      const raw = Deno.readTextFileSync(this.#path)
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) return 0
      const cursor = readIntField(parsed, 'cursor')
      return Math.max(0, cursor)
    } catch {
      return 0
    }
  }
}

export function defaultCursorPath(workspaceRoot: string): string {
  if (workspaceRoot === '/root' || workspaceRoot.startsWith('/root/')) {
    return '/root/.wuhu/cursor.json'
  }
  const home = Deno.env.get('HOME')
  if (home && home.trim()) return `${home}/.wuhu/cursor.json`
  return `${workspaceRoot}/.wuhu/cursor.json`
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const item of content) {
    if (!isRecord(item)) continue
    if (item.type === 'text' && typeof item.text === 'string') {
      text += item.text
    }
  }
  return text
}

function normalizeRole(role: string): PersistedUiMessageRole | null {
  switch (role) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'tool':
    case 'toolResult':
      return 'tool'
    default:
      return null
  }
}

function messageFromPiMessage(
  message: Record<string, unknown>,
): Omit<PersistedUiMessage, 'cursor' | 'turnIndex'> | null {
  const roleRaw = typeof message.role === 'string' ? message.role : 'assistant'
  const role = normalizeRole(roleRaw)
  if (!role) return null

  const content = extractTextFromContent(message.content)
  const toolName = typeof message.toolName === 'string' ? message.toolName : ''
  const toolCallId = typeof message.toolCallId === 'string'
    ? message.toolCallId
    : ''

  return {
    role,
    content,
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  }
}

function messageFromProtocol0Payload(
  payload: Record<string, unknown>,
): Omit<PersistedUiMessage, 'cursor' | 'turnIndex'> | null {
  const roleRaw = typeof payload.role === 'string' ? payload.role : 'assistant'
  const role = normalizeRole(roleRaw)
  if (!role) return null

  const text = typeof payload.text === 'string'
    ? payload.text
    : typeof payload.delta === 'string'
    ? payload.delta
    : ''
  if (!text) return null

  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const toolCallId = typeof payload.toolCallId === 'string'
    ? payload.toolCallId
    : ''

  return {
    role,
    content: text,
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  }
}

export function convertTurnToMessages(
  events: SandboxDaemonAgentEvent[],
  startCursor: number,
  turnIndex: number,
): { messages: PersistedUiMessage[]; nextCursor: number } {
  const ended: Array<Omit<PersistedUiMessage, 'cursor' | 'turnIndex'>> = []
  const started: Array<Omit<PersistedUiMessage, 'cursor' | 'turnIndex'>> = []
  let turnEndPayload: Record<string, unknown> | null = null

  for (const event of events) {
    const payload = event.payload as unknown as Record<string, unknown>
    const t = typeof payload.type === 'string' ? payload.type : event.type
    if (t === 'turn_end') {
      turnEndPayload = payload
      continue
    }
    if (t !== 'message_end' && t !== 'message_start') continue

    const messageRaw = (payload as { message?: unknown }).message
    if (isRecord(messageRaw)) {
      const parsed = messageFromPiMessage(messageRaw)
      if (!parsed) continue
      if (t === 'message_end') ended.push(parsed)
      else started.push(parsed)
      continue
    }

    const protocol0 = messageFromProtocol0Payload(payload)
    if (!protocol0) continue
    if (t === 'message_end') ended.push(protocol0)
    else started.push(protocol0)
  }

  const selected = ended.length ? ended : started
  if (!selected.length && turnEndPayload) {
    const messageRaw = (turnEndPayload as { message?: unknown }).message
    if (isRecord(messageRaw)) {
      const parsed = messageFromPiMessage(messageRaw)
      if (parsed) selected.push(parsed)
    }
    const toolResultsRaw = (turnEndPayload as { toolResults?: unknown })
      .toolResults
    if (Array.isArray(toolResultsRaw)) {
      for (const item of toolResultsRaw) {
        if (!isRecord(item)) continue
        const parsed = messageFromPiMessage(item)
        if (parsed) selected.push(parsed)
      }
    }
  }
  const base = Math.max(0, Math.floor(startCursor))
  const messages = selected.map((message, idx) => ({
    cursor: base + idx + 1,
    ...message,
    turnIndex,
  }))
  const nextCursor = base + messages.length
  return { messages, nextCursor }
}

export interface PostWithRetryOptions {
  attempts?: number
  baseDelayMs?: number
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export async function postJsonWithRetry(
  url: string,
  body: unknown,
  options: PostWithRetryOptions = {},
): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3))
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 250))
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ??
    ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) return
      const text = await res.text().catch(() => '')
      lastError = new Error(`http_${res.status}: ${text}`)
    } catch (err) {
      lastError = err
    }

    if (attempt < attempts && baseDelayMs > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1)
      await sleep(delay)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('state_post_failed')
}
