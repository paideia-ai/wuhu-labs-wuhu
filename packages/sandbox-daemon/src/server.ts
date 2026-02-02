import { Hono } from '@hono/hono'
import { streamSSE } from '@hono/hono/streaming'

import type { AgentProvider } from './agent-provider.ts'
import type {
  SandboxDaemonAbortRequest,
  SandboxDaemonAbortResponse,
  SandboxDaemonCredentialsPayload,
  SandboxDaemonEvent,
  SandboxDaemonInitRequest,
  SandboxDaemonInitResponse,
  SandboxDaemonPromptRequest,
  SandboxDaemonPromptResponse,
  SandboxDaemonStreamEnvelope,
} from './types.ts'

import type { Context } from '@hono/hono'

interface EventRecord {
  cursor: number
  event: SandboxDaemonEvent
}

function setEnvFromString(
  name: string,
  value: string | null | undefined,
): void {
  if (!name || value == null) return
  const trimmed = value.trim()
  if (!trimmed) return
  try {
    Deno.env.set(name, trimmed)
  } catch {
    // Ignore env permission or validation errors.
  }
}

function applyCredentialsToEnv(payload: SandboxDaemonCredentialsPayload): void {
  const { llm, github, extra } = payload

  if (llm) {
    setEnvFromString('OPENAI_API_KEY', llm.openaiApiKey)
    setEnvFromString('ANTHROPIC_API_KEY', llm.anthropicApiKey)
  }

  if (github) {
    setEnvFromString('GITHUB_TOKEN', github.token)
    setEnvFromString('GITHUB_USERNAME', github.username)
    setEnvFromString('GITHUB_EMAIL', github.email)
  }

  if (extra?.env) {
    for (const [key, value] of Object.entries(extra.env)) {
      setEnvFromString(key, value)
    }
  }
}

export class InMemoryEventStore {
  #events: EventRecord[] = []
  #nextCursor = 1

  append(event: SandboxDaemonEvent): EventRecord {
    const record: EventRecord = {
      cursor: this.#nextCursor++,
      event,
    }
    this.#events.push(record)
    return record
  }

  getFromCursor(cursor: number): EventRecord[] {
    return this.#events.filter((record) => record.cursor > cursor)
  }
}

export interface SandboxDaemonServerOptions {
  provider: AgentProvider
}

export interface SandboxDaemonApp {
  app: Hono
  eventStore: InMemoryEventStore
}

export function createSandboxDaemonApp(
  options: SandboxDaemonServerOptions,
): SandboxDaemonApp {
  const { provider } = options
  const app = new Hono()
  const eventStore = new InMemoryEventStore()

  provider.onEvent((event) => {
    eventStore.append(event)
  })

  app.post('/credentials', async (c: Context) => {
    let payload: SandboxDaemonCredentialsPayload
    try {
      payload = await c.req.json<SandboxDaemonCredentialsPayload>()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    try {
      applyCredentialsToEnv(payload)
      // Protocol 0: accept and acknowledge. Wiring to actual storage
      // and sandbox environment happens in the concrete daemon.
      return c.json({ ok: true })
    } catch (error) {
      console.error('Failed to apply credentials', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  })

  app.post('/init', async (c: Context) => {
    let body: SandboxDaemonInitRequest
    try {
      body = await c.req.json<SandboxDaemonInitRequest>()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    if (
      !body.workspace || !Array.isArray(body.workspace.repos)
    ) {
      return c.json({ error: 'Invalid init payload' }, 400)
    }

    const response: SandboxDaemonInitResponse = {
      ok: true,
      workspace: {
        repos: body.workspace.repos.map((repo) => {
          if (
            !repo || typeof repo.id !== 'string' ||
            typeof repo.path !== 'string'
          ) {
            throw new Error('Invalid repo config')
          }
          return {
            id: repo.id,
            path: repo.path,
          }
        }),
      },
    }
    try {
      return c.json(response)
    } catch (error) {
      console.error('Failed to handle init request', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  })

  app.post('/prompt', async (c: Context) => {
    let body: SandboxDaemonPromptRequest
    try {
      body = await c.req.json<SandboxDaemonPromptRequest>()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    try {
      await provider.sendPrompt(body)
    } catch (error) {
      console.error('Failed to handle prompt', error)
      return c.json({ error: 'Internal server error' }, 500)
    }

    const response: SandboxDaemonPromptResponse = {
      success: true,
      command: 'prompt',
    }
    return c.json(response)
  })

  app.post('/abort', async (c: Context) => {
    let body: SandboxDaemonAbortRequest | undefined
    try {
      body = await c.req.json<SandboxDaemonAbortRequest>()
    } catch {
      // Treat missing or malformed body as a best-effort abort with no details.
      body = undefined
    }

    try {
      await provider.abort(body)
    } catch (error) {
      console.error('Failed to handle abort', error)
      return c.json({ error: 'Internal server error' }, 500)
    }

    const response: SandboxDaemonAbortResponse = {
      success: true,
      command: 'abort',
    }
    return c.json(response)
  })

  app.get('/stream', (c: Context) => {
    const cursorParam = c.req.query('cursor')
    const cursor = cursorParam ? Number(cursorParam) || 0 : 0

    return streamSSE(c, async (stream) => {
      const records = eventStore.getFromCursor(cursor)
      for (const record of records) {
        const envelope: SandboxDaemonStreamEnvelope<SandboxDaemonEvent> = {
          cursor: record.cursor,
          event: record.event,
        }
        await stream.writeSSE({
          id: String(record.cursor),
          data: JSON.stringify(envelope),
        })
      }
    })
  })

  return { app, eventStore }
}
