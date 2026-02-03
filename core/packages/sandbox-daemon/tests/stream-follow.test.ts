import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type {
  SandboxDaemonAgentEvent,
  SandboxDaemonStreamEnvelope,
} from '../src/types.ts'

async function readNextEnvelope(
  res: Response,
  timeoutMs = 2000,
): Promise<SandboxDaemonStreamEnvelope> {
  if (!res.body) {
    throw new Error('missing response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx === -1) break
      const line = buffer.slice(0, idx).trimEnd()
      buffer = buffer.slice(idx + 1)
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice('data: '.length)
        try {
          const env = JSON.parse(jsonStr) as SandboxDaemonStreamEnvelope
          await reader.cancel()
          return env
        } catch {
          // keep reading
        }
      }
    }
  }

  await reader.cancel()
  throw new Error('timed out waiting for SSE data')
}

Deno.test('SSE follow: resumes from non-zero cursor', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  provider.emit({
    source: 'agent',
    type: 'message_update',
    payload: { type: 'message_update', text: 'first' },
  })

  const res = await app.request('/stream?cursor=1&follow=1', { method: 'GET' })

  const second: SandboxDaemonAgentEvent = {
    source: 'agent',
    type: 'message_update',
    payload: { type: 'message_update', text: 'second' },
  }
  provider.emit(second)

  const env = await readNextEnvelope(res)
  assertEquals(env.cursor, 2)
  assertEquals(
    (env.event as { payload?: { text?: string } }).payload?.text,
    'second',
  )
})

Deno.test('SSE follow: multiple subscribers receive same event', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const resA = await app.request('/stream?cursor=0&follow=1', { method: 'GET' })
  const resB = await app.request('/stream?cursor=0&follow=1', { method: 'GET' })

  const event: SandboxDaemonAgentEvent = {
    source: 'agent',
    type: 'message_update',
    payload: { type: 'message_update', text: 'hi' },
  }
  provider.emit(event)

  const envA = await readNextEnvelope(resA)
  const envB = await readNextEnvelope(resB)
  assertEquals(envA.cursor, 1)
  assertEquals(envB.cursor, 1)
  assertEquals(
    (envA.event as { payload?: { text?: string } }).payload?.text,
    'hi',
  )
  assertEquals(
    (envB.event as { payload?: { text?: string } }).payload?.text,
    'hi',
  )
})
