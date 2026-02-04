import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type {
  SandboxDaemonAgentEvent,
  SandboxDaemonInitRequest,
} from '../src/types.ts'

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timed_out')
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

Deno.test('daemon persists UI messages to Core after turn_end', async () => {
  const provider = new FakeAgentProvider()
  const tmp = await Deno.makeTempDir()
  const cursorPath = `${tmp}/cursor.json`

  const calls: Array<{ url: string; body: unknown }> = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url
    const initAny = init as unknown as { body?: unknown } | undefined
    const body = initAny?.body ? JSON.parse(String(initAny.body)) : null
    calls.push({ url, body })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const { app } = createSandboxDaemonApp({
    provider,
    workspaceRoot: tmp,
    statePersistence: {
      cursorPath,
      fetchFn,
      baseDelayMs: 1,
      sleep: async () => {},
    },
  })

  const initPayload: SandboxDaemonInitRequest = {
    sandboxId: 'sb_test',
    coreApiUrl: 'http://core.local',
    repo: 'wuhu-labs/wuhu',
    workspace: { repos: [] },
  }

  const initRes = await app.request('/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(initPayload),
  })
  assertEquals(initRes.status, 200)

  provider.emit(agentEvent({ type: 'turn_start' }))
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        timestamp: 1,
      },
    }),
  )
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        timestamp: 2,
      },
    }),
  )
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolName: 'bash',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: 'pwd\n' }],
        timestamp: 3,
      },
    }),
  )
  provider.emit(agentEvent({ type: 'turn_end' }))

  await waitFor(() => calls.length >= 1)

  assertEquals(calls[0].url, 'http://core.local/sandboxes/sb_test/state')
  const body = calls[0].body as {
    cursor: number
    messages: Array<{
      cursor: number
      role: string
      content: string
      toolName?: string
      toolCallId?: string
      turnIndex: number
    }>
  }
  assertEquals(body.cursor, 3)
  assertEquals(
    body.messages.map((m) => ({
      cursor: m.cursor,
      role: m.role,
      content: m.content,
    })),
    [
      { cursor: 1, role: 'user', content: 'hi' },
      { cursor: 2, role: 'assistant', content: 'ok' },
      { cursor: 3, role: 'tool', content: 'pwd\n' },
    ],
  )
  assertEquals(body.messages[2].toolName, 'bash')
  assertEquals(body.messages[2].toolCallId, 'call_1')
  assertEquals(body.messages[0].turnIndex, 1)
  assertEquals(body.messages[2].turnIndex, 1)

  const persisted = JSON.parse(await Deno.readTextFile(cursorPath)) as {
    cursor: number
  }
  assertEquals(persisted.cursor, 3)

  provider.emit(agentEvent({ type: 'turn_start' }))
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'second' }],
        timestamp: 4,
      },
    }),
  )
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        timestamp: 5,
      },
    }),
  )
  provider.emit(agentEvent({ type: 'turn_end' }))

  await waitFor(() => calls.length >= 2)
  const body2 = calls[1].body as {
    cursor: number
    messages: Array<{ cursor: number }>
  }
  assertEquals(body2.cursor, 5)
  assertEquals(body2.messages.map((m) => m.cursor), [4, 5])
})

Deno.test('state persistence retries POST failures (best-effort)', async () => {
  const provider = new FakeAgentProvider()
  const tmp = await Deno.makeTempDir()
  const cursorPath = `${tmp}/cursor.json`

  let attempt = 0
  const attemptsSeen: number[] = []
  const fetchFn: typeof fetch = async () => {
    attempt++
    attemptsSeen.push(attempt)
    if (attempt < 3) {
      return new Response('nope', { status: 503 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const { app } = createSandboxDaemonApp({
    provider,
    workspaceRoot: tmp,
    statePersistence: {
      cursorPath,
      fetchFn,
      baseDelayMs: 1,
      sleep: async () => {},
    },
  })

  const initPayload: SandboxDaemonInitRequest = {
    sandboxId: 'sb_retry',
    coreApiUrl: 'http://core.local',
    workspace: { repos: [] },
  }

  const initRes = await app.request('/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(initPayload),
  })
  assertEquals(initRes.status, 200)

  provider.emit(agentEvent({ type: 'turn_start' }))
  provider.emit(
    agentEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'retry me' }],
        timestamp: 1,
      },
    }),
  )
  provider.emit(agentEvent({ type: 'turn_end' }))

  await waitFor(() => attempt >= 3)
  assertEquals(attemptsSeen, [1, 2, 3])
})
