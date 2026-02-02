import { assertEquals } from '@std/assert'

import { FakeAgentProvider } from '../src/agent-provider.ts'
import { signHs256Jwt } from '../src/auth.ts'
import { createSandboxDaemonApp } from '../src/server.ts'
import type { SandboxDaemonJwtClaims } from '../src/types.ts'

const secret = 'test-secret'

function futureExp(secondsFromNow = 60): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow
}

async function token(scope: 'admin' | 'user'): Promise<string> {
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

Deno.test('JWT: user can stream and prompt but not admin endpoints', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const userToken = await token('user')

  const streamRes = await app.request('/stream?cursor=0', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userToken}` },
  })
  assertEquals(streamRes.status, 200)

  const promptRes = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })
  assertEquals(promptRes.status, 200)

  const initRes = await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ workspace: { repos: [] } }),
  })
  assertEquals(initRes.status, 403)
})

Deno.test('JWT: admin can call init and credentials', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const adminToken = await token('admin')

  const initRes = await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ workspace: { repos: [] } }),
  })
  assertEquals(initRes.status, 200)

  const credentialsRes = await app.request('/credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ version: 'test' }),
  })
  assertEquals(credentialsRes.status, 200)
})

Deno.test('CORS: allowlist set via init; preflight is unauthenticated', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })

  const adminToken = await token('admin')
  const userToken = await token('user')
  const origin = 'https://ui.example'

  const initRes = await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      workspace: { repos: [] },
      cors: { allowedOrigins: [origin] },
    }),
  })
  assertEquals(initRes.status, 200)

  const preflightRes = await app.request('/prompt', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  })
  assertEquals(preflightRes.status, 204)
  assertEquals(preflightRes.headers.get('access-control-allow-origin'), origin)

  const promptRes = await app.request('/prompt', {
    method: 'POST',
    headers: {
      Origin: origin,
      'content-type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })
  assertEquals(promptRes.status, 200)
  assertEquals(promptRes.headers.get('access-control-allow-origin'), origin)
})
