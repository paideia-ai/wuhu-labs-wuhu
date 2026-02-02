import { Hono } from '@hono/hono'
import { streamSSE } from '@hono/hono/streaming'
import { z } from 'zod'

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

async function readJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

const zCredentialsPayload = z
  .object({
    version: z.string(),
    llm: z
      .object({
        anthropicApiKey: z.union([z.string(), z.null()]).optional(),
        openaiApiKey: z.union([z.string(), z.null()]).optional(),
      })
      .passthrough()
      .optional(),
    github: z
      .object({
        token: z.string(),
        username: z.string().optional(),
        email: z.string().optional(),
      })
      .passthrough()
      .optional(),
    extra: z
      .object({
        env: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const zInitRepoConfig = z
  .object({
    id: z.string(),
    source: z.string(),
    path: z.string(),
    branch: z.string().optional(),
  })
  .passthrough()

const zInitRequest = z
  .object({
    workspace: z
      .object({
        repos: z.array(zInitRepoConfig),
      })
      .passthrough(),
    gitCheckpoint: z.unknown().optional(),
    agent: z.unknown().optional(),
  })
  .passthrough()

const zPromptRequest = z
  .object({
    message: z.string(),
    images: z.array(z.unknown()).optional(),
    streamingBehavior: z.enum(['steer', 'followUp']).optional(),
  })
  .passthrough()

const zAbortRequest = z
  .object({
    reason: z.string().optional(),
  })
  .passthrough()

interface EventRecord {
  cursor: number
  event: SandboxDaemonEvent
}

export class InMemoryEventStore {
  #events: EventRecord[] = []
  #nextCursor = 1
  #subscribers = new Set<(record: EventRecord) => void>()

  append(event: SandboxDaemonEvent): EventRecord {
    const record: EventRecord = {
      cursor: this.#nextCursor++,
      event,
    }
    this.#events.push(record)
    for (const subscriber of this.#subscribers) {
      subscriber(record)
    }
    return record
  }

  getFromCursor(cursor: number): EventRecord[] {
    return this.#events.filter((record) => record.cursor > cursor)
  }

  subscribe(handler: (record: EventRecord) => void): () => void {
    this.#subscribers.add(handler)
    return () => {
      this.#subscribers.delete(handler)
    }
  }
}

export interface SandboxDaemonServerOptions {
  provider: AgentProvider
  onCredentials?: (
    payload: SandboxDaemonCredentialsPayload,
  ) => void | Promise<void>
}

export interface SandboxDaemonApp {
  app: Hono
  eventStore: InMemoryEventStore
}

export function createSandboxDaemonApp(
  options: SandboxDaemonServerOptions,
): SandboxDaemonApp {
  const { provider, onCredentials } = options
  const app = new Hono()
  const eventStore = new InMemoryEventStore()

  provider.onEvent((event) => {
    eventStore.append(event)
  })

  app.post('/credentials', async (c: Context) => {
    const raw = await readJsonBody(c)
    if (raw === null) {
      return c.json({ ok: false, error: 'invalid_json' }, 400)
    }
    const parsed = zCredentialsPayload.safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_credentials_payload' }, 400)
    }
    const payload = parsed.data as SandboxDaemonCredentialsPayload
    if (onCredentials) {
      try {
        await onCredentials(payload)
      } catch {
        return c.json({ ok: false, error: 'credentials_error' }, 500)
      }
    }
    // Protocol 0: accept and acknowledge. Wiring to actual storage
    // and sandbox environment happens in the concrete daemon.
    return c.json({ ok: true })
  })

  app.post('/init', async (c: Context) => {
    const raw = await readJsonBody(c)
    if (raw === null) {
      return c.json({ ok: false, error: 'invalid_json' }, 400)
    }
    const parsed = zInitRequest.safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_init_payload' }, 400)
    }
    const body = parsed.data as SandboxDaemonInitRequest
    const response: SandboxDaemonInitResponse = {
      ok: true,
      workspace: {
        repos: body.workspace.repos.map((repo) => ({
          id: repo.id,
          path: repo.path,
        })),
      },
    }
    return c.json(response)
  })

  app.post('/prompt', async (c: Context) => {
    const raw = await readJsonBody(c)
    if (raw === null) {
      return c.json({ success: false, error: 'invalid_prompt_payload' }, 400)
    }
    const parsed = zPromptRequest.safeParse(raw)
    if (!parsed.success) {
      return c.json({ success: false, error: 'invalid_prompt_payload' }, 400)
    }
    const body = parsed.data as SandboxDaemonPromptRequest
    try {
      await provider.sendPrompt(body)
    } catch {
      return c.json({ success: false, error: 'provider_error' }, 500)
    }
    const response: SandboxDaemonPromptResponse = {
      success: true,
      command: 'prompt',
    }
    return c.json(response)
  })

  app.post('/abort', async (c: Context) => {
    const raw = await readJsonBody(c)
    const parsed = raw === null ? null : zAbortRequest.safeParse(raw)
    const body = parsed?.success
      ? (parsed.data as SandboxDaemonAbortRequest)
      : undefined
    try {
      await provider.abort(body)
    } catch {
      return c.json({ success: false, error: 'provider_error' }, 500)
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
    const followParam = c.req.query('follow')
    const follow = followParam === '1' || followParam === 'true'

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

      if (!follow) {
        return
      }

      let lastSentCursor = records.length
        ? records[records.length - 1].cursor
        : cursor

      const send = async (record: EventRecord) => {
        lastSentCursor = record.cursor
        const envelope: SandboxDaemonStreamEnvelope<SandboxDaemonEvent> = {
          cursor: record.cursor,
          event: record.event,
        }
        await stream.writeSSE({
          id: String(record.cursor),
          data: JSON.stringify(envelope),
        })
      }
      const sendSafe = async (record: EventRecord) => {
        try {
          await send(record)
        } catch {
          // Ignore stream errors; disconnect will end the request.
        }
      }

      const heartbeat = async () => {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ cursor: lastSentCursor }),
        })
      }

      const unsubscribe = eventStore.subscribe((record) => {
        // Best-effort fire-and-forget; SSE stream errors will end the request.
        void sendSafe(record)
      })

      try {
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 15_000))
          await heartbeat()
        }
      } catch {
        // Ignore stream errors
      } finally {
        unsubscribe?.()
      }
    })
  })

  return { app, eventStore }
}
