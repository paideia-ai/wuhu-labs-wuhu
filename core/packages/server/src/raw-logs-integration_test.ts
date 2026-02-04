import { assert, assertEquals } from '@std/assert'
import { Hono } from '@hono/hono'

import { FakeAgentProvider } from '../../sandbox-daemon/src/agent-provider.ts'
import { createSandboxDaemonApp } from '../../sandbox-daemon/src/server.ts'
import type { SandboxDaemonAgentEvent } from '../../sandbox-daemon/src/types.ts'

import type { S3RawLogsConfig } from './config.ts'
import { RawLogsS3Store } from './raw-logs-s3.ts'

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timed_out')
}

function loadS3TestConfig(): S3RawLogsConfig | null {
  const endpoint = (Deno.env.get('S3_ENDPOINT') ?? '').trim()
  const bucket = (Deno.env.get('S3_BUCKET') ?? '').trim()
  const accessKeyId = (Deno.env.get('S3_ACCESS_KEY_ID') ?? '').trim()
  const secretAccessKey = (Deno.env.get('S3_SECRET_ACCESS_KEY') ?? '').trim()
  const region = (Deno.env.get('S3_REGION') ?? 'us-east-1').trim() ||
    'us-east-1'
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle: true,
    presignExpiresInSeconds: 60,
  }
}

function agentEvent(payload: Record<string, unknown>): SandboxDaemonAgentEvent {
  const type = typeof payload.type === 'string' ? payload.type : 'unknown'
  return {
    source: 'agent',
    type,
    timestamp: Date.now(),
    payload: { ...payload, type },
  }
}

Deno.test({
  name: 'integration: daemon uploads raw logs to S3 after turn',
  ignore: !loadS3TestConfig(),
  fn: async () => {
    const s3 = loadS3TestConfig()
    if (!s3) return

    const store = new RawLogsS3Store(s3)
    const sandboxId = `sb_int_${crypto.randomUUID().slice(0, 10)}`

    const coreApp = new Hono()
    coreApp.post('/sandboxes/:id/state', (c) => c.json({ ok: true }))
    coreApp.post('/sandboxes/:id/logs', async (c) => {
      const id = c.req.param('id')
      const turnIndexRaw = c.req.query('turnIndex')
      const parsedTurnIndex = turnIndexRaw ? Number(turnIndexRaw) : NaN
      const turnIndex = Number.isFinite(parsedTurnIndex)
        ? Math.floor(parsedTurnIndex)
        : NaN
      if (!Number.isInteger(turnIndex) || turnIndex < 0) {
        return c.json({ error: 'invalid_turn_index' }, 400)
      }
      if (!c.req.raw.body) return c.json({ error: 'missing_body' }, 400)
      await store.uploadTurn(id, turnIndex, c.req.raw.body)
      return c.json({ ok: true })
    })

    const fetchFn: typeof fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url
      const parsed = new URL(url)
      const req = new Request(
        `http://core.test${parsed.pathname}${parsed.search}`,
        init,
      )
      return await coreApp.fetch(req)
    }

    const provider = new FakeAgentProvider()
    const tmp = await Deno.makeTempDir()
    const { app } = createSandboxDaemonApp({
      provider,
      workspaceRoot: tmp,
      statePersistence: {
        cursorPath: `${tmp}/cursor.json`,
        fetchFn,
        baseDelayMs: 1,
        sleep: async () => {},
      },
    })

    const initRes = await app.request('/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sandboxId,
        coreApiUrl: 'http://core.local',
        workspace: { repos: [] },
      }),
    })
    assertEquals(initRes.status, 200)

    provider.emit(agentEvent({ type: 'turn_start', timestamp: 1 }))
    provider.emit(
      agentEvent({
        type: 'message_end',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          timestamp: 2,
        },
      }),
    )
    provider.emit(agentEvent({ type: 'turn_end', timestamp: 3 }))

    await waitFor(() => store.existsTurn(sandboxId, 1))

    const { url } = await store.presignGetTurn(sandboxId, 1, 60)
    const res = await fetch(url)
    assertEquals(res.status, 200)
    const text = await res.text()
    const lines = text.trimEnd().split('\n').map((line) =>
      JSON.parse(line) as { type: string }
    )
    assert(lines.length >= 2)
    assertEquals(lines[0]?.type, 'turn_start')
    assertEquals(lines.at(-1)?.type, 'turn_end')
  },
})
