import { z } from 'zod'
import type { MiddlewareHandler } from '@hono/hono'
import type { SandboxDaemonJwtClaims, SandboxDaemonScope } from './types.ts'

const zJwtHeader = z.object({
  alg: z.string(),
  typ: z.string().optional(),
}).passthrough()

const zJwtClaims = z.object({
  iss: z.string().optional(),
  sub: z.string(),
  scope: z.union([z.literal('admin'), z.literal('user')]),
  exp: z.number(),
}).passthrough()

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((input.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

async function hmacSha256(
  secret: string,
  message: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  return new Uint8Array(signature)
}

export interface JwtAuthOptions {
  secret?: string
  issuer?: string
  /**
   * When false, skips all auth checks (dev mode).
   * When true, requires a `secret` to be provided.
   */
  enabled?: boolean
}

export async function verifyHs256Jwt(
  token: string,
  options: JwtAuthOptions,
): Promise<SandboxDaemonJwtClaims> {
  if (!options.secret) {
    throw new Error('missing_jwt_secret')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('invalid_jwt_format')
  }
  const [headerB64, payloadB64, signatureB64] = parts

  let headerJson: unknown
  let payloadJson: unknown
  try {
    headerJson = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(headerB64)),
    )
    payloadJson = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)),
    )
  } catch {
    throw new Error('invalid_jwt_json')
  }

  const headerParsed = zJwtHeader.safeParse(headerJson)
  if (!headerParsed.success) {
    throw new Error('invalid_jwt_header')
  }
  if (headerParsed.data.alg !== 'HS256') {
    throw new Error('unsupported_jwt_alg')
  }

  const claimsParsed = zJwtClaims.safeParse(payloadJson)
  if (!claimsParsed.success) {
    throw new Error('invalid_jwt_claims')
  }

  const signingInput = `${headerB64}.${payloadB64}`
  const expectedSig = await hmacSha256(options.secret, signingInput)
  const actualSig = base64UrlDecodeToBytes(signatureB64)
  if (!timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('invalid_jwt_signature')
  }

  const claims = claimsParsed.data as SandboxDaemonJwtClaims
  if (options.issuer && claims.iss && claims.iss !== options.issuer) {
    throw new Error('invalid_jwt_issuer')
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    throw new Error('invalid_jwt_exp')
  }
  if (claims.exp <= now) {
    throw new Error('jwt_expired')
  }

  return claims
}

export async function signHs256Jwt(
  claims: SandboxDaemonJwtClaims,
  secret: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64UrlEncodeBytes(
    new TextEncoder().encode(JSON.stringify(header)),
  )
  const payloadB64 = base64UrlEncodeBytes(
    new TextEncoder().encode(JSON.stringify(claims)),
  )
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await hmacSha256(secret, signingInput)
  const signatureB64 = base64UrlEncodeBytes(signature)
  return `${signingInput}.${signatureB64}`
}

const JWT_CLAIMS_KEY = 'wuhu.jwtClaims'

function setJwtClaims(
  c: Parameters<MiddlewareHandler>[0],
  claims: SandboxDaemonJwtClaims,
): void {
  // Avoid global type augmentation (JSR no-slow-types rule).
  c.set(JWT_CLAIMS_KEY as never, claims as never)
}

function getJwtClaims(
  c: Parameters<MiddlewareHandler>[0],
): SandboxDaemonJwtClaims | undefined {
  return c.get(JWT_CLAIMS_KEY as never) as SandboxDaemonJwtClaims | undefined
}

export function createJwtMiddleware(
  options: JwtAuthOptions,
): MiddlewareHandler {
  const enabled = options.enabled ?? Boolean(options.secret)
  if (!enabled) {
    return async (_c, next) => {
      await next()
    }
  }
  if (!options.secret) {
    throw new Error('JWT auth enabled but no secret provided')
  }

  return async (c, next) => {
    const auth = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ ok: false, error: 'missing_auth' }, 401)
    }
    const token = auth.slice('Bearer '.length).trim()
    try {
      const claims = await verifyHs256Jwt(token, options)
      setJwtClaims(c, claims)
    } catch {
      return c.json({ ok: false, error: 'invalid_auth' }, 401)
    }
    await next()
  }
}

export function requireScope(required: SandboxDaemonScope): MiddlewareHandler {
  return async (c, next) => {
    const claims = getJwtClaims(c)
    if (!claims) {
      return c.json({ ok: false, error: 'missing_auth' }, 401)
    }
    // admin scope can access everything
    // user scope can only access user-level endpoints (prompt, abort, stream)
    if (required === 'admin' && claims.scope !== 'admin') {
      return c.json({ ok: false, error: 'insufficient_scope' }, 403)
    }
    await next()
  }
}
