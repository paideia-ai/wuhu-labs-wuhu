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

  // user can access /stream
  const streamRes = await app.request('/stream?cursor=0', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userToken}` },
  })
  assertEquals(streamRes.status, 200)

  // user can access /prompt
  const promptRes = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })
  assertEquals(promptRes.status, 200)

  // user cannot access /credentials (admin only)
  const credentialsRes = await app.request('/credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ version: 'test' }),
  })
  assertEquals(credentialsRes.status, 403)
})

Deno.test('JWT: admin can call all endpoints', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const adminToken = await token('admin')

  // admin can call /prompt
  const promptRes = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ message: 'hi' }),
  })
  assertEquals(promptRes.status, 200)

  // admin can call /credentials
  const credentialsRes = await app.request('/credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ version: 'test' }),
  })
  assertEquals(credentialsRes.status, 200)

  // admin can call /stream
  const streamRes = await app.request('/stream?cursor=0', {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assertEquals(streamRes.status, 200)
})

Deno.test('CORS: OPTIONS preflight without auth when origin is allowed', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const adminToken = await token('admin')

  // First, configure CORS via /init
  const initRes = await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      workspace: { repos: [] },
      cors: { allowedOrigins: ['https://example.com'] },
    }),
  })
  assertEquals(initRes.status, 200)

  // Preflight should work without auth when origin is allowed
  const preflightRes = await app.request('/prompt', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.com',
    },
  })
  assertEquals(preflightRes.status, 204)
  assertEquals(
    preflightRes.headers.get('Access-Control-Allow-Origin'),
    'https://example.com',
  )
  assertEquals(
    preflightRes.headers.get('Access-Control-Allow-Methods'),
    'GET,POST,OPTIONS',
  )
})

Deno.test('CORS: actual request gets CORS headers when origin is allowed', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const adminToken = await token('admin')

  // Configure CORS via /init
  await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      workspace: { repos: [] },
      cors: { allowedOrigins: ['https://example.com'] },
    }),
  })

  // Request with allowed origin should get CORS headers
  const res = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      Origin: 'https://example.com',
    },
    body: JSON.stringify({ message: 'test' }),
  })
  assertEquals(res.status, 200)
  assertEquals(
    res.headers.get('Access-Control-Allow-Origin'),
    'https://example.com',
  )
})

Deno.test('CORS: request from non-allowed origin gets no CORS headers', async () => {
  const provider = new FakeAgentProvider()
  const { app } = createSandboxDaemonApp({
    provider,
    auth: { secret, issuer: 'wuhu-test', enabled: true },
  })
  const adminToken = await token('admin')

  // Configure CORS via /init with specific origin
  await app.request('/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      workspace: { repos: [] },
      cors: { allowedOrigins: ['https://allowed.com'] },
    }),
  })

  // Request from different origin should not get CORS headers
  const res = await app.request('/prompt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      Origin: 'https://notallowed.com',
    },
    body: JSON.stringify({ message: 'test' }),
  })
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), null)
})
