import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type {
  SandboxDaemonAgentEvent,
  SandboxDaemonCredentialsPayload,
  SandboxDaemonInitRequest,
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

Deno.test('POST /credentials accepts payload and returns ok', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const payload: SandboxDaemonCredentialsPayload = {
    version: '1',
    llm: {
      openaiApiKey: 'test-openai-key',
    },
    github: {
      token: 'ghp_test',
      username: 'octocat',
      email: 'octocat@example.com',
    },
    extra: {
      env: {
        CUSTOM_VAR: 'value',
      },
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

Deno.test('POST /init echoes repo summaries with id and path', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({ provider })

  const payload: SandboxDaemonInitRequest = {
    workspace: {
      repos: [
        {
          id: 'wuhu',
          source: 'local:/root/repo',
          path: 'repo',
          branch: 'main',
        },
        {
          id: 'pi-mono',
          source: 'local:/root/pi-mono',
          path: 'pi-mono',
        },
      ],
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
  const json = (await res.json()) as {
    ok: boolean
    workspace: { repos: Array<{ id: string; path: string; branch?: string }> }
  }

  assertEquals(json.ok, true)
  assertEquals(json.workspace.repos.length, 2)
  assertEquals(json.workspace.repos[0], {
    id: 'wuhu',
    path: 'repo',
  })
  assertEquals(json.workspace.repos[1], {
    id: 'pi-mono',
    path: 'pi-mono',
  })
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
