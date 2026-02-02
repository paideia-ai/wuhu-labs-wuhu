import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { signHs256Jwt } from '../src/auth.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type { SandboxDaemonJwtClaims } from '../src/types.ts'

const secret = 'test-secret'

function futureExp(secondsFromNow = 60): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow
}

async function token(scope: 'control' | 'observer'): Promise<string> {
  const claims: SandboxDaemonJwtClaims = {
    sub: 'tester',
    scope,
    exp: futureExp(),
    iss: 'wuhu-test',
  }
  return await signHs256Jwt(claims, secret)
}

Deno.test('JWT: missing bearer token rejected', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })

  const res = await app.request('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  })

  assertEquals(res.status, 401)
})

Deno.test('JWT: observer can stream but not control endpoints', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const observerToken = await token('observer')

  const streamRes = await app.request('/stream?cursor=0', {
    method: 'GET',
    headers: { Authorization: `Bearer ${observerToken}` },
  })
  assertEquals(streamRes.status, 200)

  const promptRes = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${observerToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })
  assertEquals(promptRes.status, 403)
})

Deno.test('JWT: control can call prompt', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const controlToken = await token('control')

  const res = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${controlToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })

  assertEquals(res.status, 200)
})
