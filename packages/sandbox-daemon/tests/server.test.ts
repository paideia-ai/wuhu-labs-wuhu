import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type {
  SandboxDaemonAgentEvent,
  SandboxDaemonCredentialsPayload,
  SandboxDaemonInitRequest,
  SandboxDaemonInitResponse,
  SandboxDaemonPromptRequest,
  SandboxDaemonStreamEnvelope,
} from '../src/types.ts'

Deno.test('POST /prompt forwards to provider and returns success', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const payload: SandboxDaemonPromptRequest = {
    message: 'Hello, daemon',
  }

  const res = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json, { success: true, command: 'prompt' })
  assertEquals(provider.prompts.length, 1)
  assertEquals(provider.prompts[0].message, 'Hello, daemon')
})

Deno.test('GET /stream returns SSE with agent events from cursor', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const event: SandboxDaemonAgentEvent = {
    source: 'agent',
    type: 'message_update',
    payload: {
      type: 'message_update',
      text: 'partial',
    },
  }
  provider.emit(event)

  const res = await app.request('/stream?cursor=0', {
    method: 'GET',
  })

  assertEquals(res.status, 200)
  const text = await res.text()

  const dataLines = text.split('\n').filter((line: string) =>
    line.startsWith('data: ')
  )
  assertEquals(dataLines.length, 1)

  const jsonStr = dataLines[0].slice('data: '.length)
  const envelope = JSON.parse(jsonStr) as SandboxDaemonStreamEnvelope<
    SandboxDaemonAgentEvent
  >

  assertEquals(envelope.cursor, 1)
  assertEquals(envelope.event.source, 'agent')
  assertEquals(envelope.event.type, 'message_update')
  assertEquals(envelope.event.payload.text, 'partial')
})

Deno.test('POST /credentials accepts payload and returns ok', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const payload: SandboxDaemonCredentialsPayload = {
    version: '1',
    llm: {
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: 'sk-test',
    },
    github: {
      token: 'ghp_test',
      username: 'testuser',
      email: 'test@example.com',
    },
  }

  const res = await app.request('/credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json, { ok: true })
})

Deno.test('POST /init echoes repo summaries', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const payload: SandboxDaemonInitRequest = {
    workspace: {
      repos: [
        {
          id: 'my-repo',
          source: 'github:owner/repo',
          path: '/workspace/my-repo',
          branch: 'main',
        },
        {
          id: 'other-repo',
          source: 'github:owner/other',
          path: '/workspace/other',
        },
      ],
    },
    gitCheckpoint: {
      mode: 'per-turn',
      branchName: 'wuhu/checkpoint',
    },
  }

  const res = await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  assertEquals(res.status, 200)
  const json = (await res.json()) as SandboxDaemonInitResponse
  assertEquals(json.ok, true)
  assertEquals(json.workspace.repos.length, 2)
  assertEquals(json.workspace.repos[0].id, 'my-repo')
  assertEquals(json.workspace.repos[0].path, '/workspace/my-repo')
  assertEquals(json.workspace.repos[1].id, 'other-repo')
})

Deno.test('POST /abort calls provider.abort and returns success', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const res = await app.request('/abort', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reason: 'user cancelled' }),
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json, { success: true, command: 'abort' })
  assertEquals(provider.abortCalls, 1)
})

Deno.test('GET /stream respects cursor parameter', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  // Emit multiple events
  provider.emit({
    source: 'agent',
    type: 'event_1',
    payload: { type: 'event_1' },
  })
  provider.emit({
    source: 'agent',
    type: 'event_2',
    payload: { type: 'event_2' },
  })
  provider.emit({
    source: 'agent',
    type: 'event_3',
    payload: { type: 'event_3' },
  })

  // Request from cursor 1 (should skip first event)
  const res = await app.request('/stream?cursor=1', {
    method: 'GET',
  })

  assertEquals(res.status, 200)
  const text = await res.text()

  const dataLines = text.split('\n').filter((line: string) =>
    line.startsWith('data: ')
  )
  assertEquals(dataLines.length, 2)

  const envelope1 = JSON.parse(
    dataLines[0].slice('data: '.length),
  ) as SandboxDaemonStreamEnvelope<SandboxDaemonAgentEvent>
  const envelope2 = JSON.parse(
    dataLines[1].slice('data: '.length),
  ) as SandboxDaemonStreamEnvelope<SandboxDaemonAgentEvent>

  assertEquals(envelope1.cursor, 2)
  assertEquals(envelope1.event.type, 'event_2')
  assertEquals(envelope2.cursor, 3)
  assertEquals(envelope2.event.type, 'event_3')
})
