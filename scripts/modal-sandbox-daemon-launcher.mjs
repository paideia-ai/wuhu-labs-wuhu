import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { ModalClient } from 'modal'

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value.trim()
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`))
    })
  })
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function signHs256Jwt(claims, secret) {
  const headerB64 = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payloadB64 = base64url(JSON.stringify(claims))
  const signingInput = `${headerB64}.${payloadB64}`
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest()
  const sigB64 = Buffer.from(sig)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${signingInput}.${sigB64}`
}

async function uploadFile(sb, remotePath, bytes) {
  const file = await sb.open(remotePath, 'w')
  await file.write(bytes)
  await file.flush()
  await file.close()
}

async function uploadDir(sb, localDir, remoteDir) {
  await sb.exec(['mkdir', '-p', remoteDir])
  const entries = await fs.readdir(localDir, { withFileTypes: true })
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name)
    const remotePath = path.posix.join(remoteDir, entry.name)
    if (entry.isDirectory()) {
      await uploadDir(sb, localPath, remotePath)
      continue
    }
    const bytes = await fs.readFile(localPath)
    await uploadFile(sb, remotePath, bytes)
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const uiRoot = path.join(repoRoot, 'frontend', 'sandbox-daemon-ui')
const daemonEntry = path.join(repoRoot, 'packages', 'sandbox-daemon', 'main.ts')
const bundlePath = path.join(tmpdir(), 'sandbox-daemon.bundle.js')

const daemonPort = Number(process.env.SANDBOX_DAEMON_PORT || 8787)
const uiPort = Number(process.env.SANDBOX_DAEMON_UI_PORT || 4173)
const appName = process.env.SANDBOX_DAEMON_MODAL_APP ||
  'wuhu-sandbox-daemon-debug'
const oneHour = 60 * 60 * 1000

console.log('Bundling sandbox daemon...')
await run('deno', ['bundle', '-o', bundlePath, daemonEntry])

console.log('Building sandbox daemon UI...')
await run('bun', ['install'], { cwd: uiRoot })
await run('bun', ['run', 'build'], { cwd: uiRoot })

const uiDist = path.join(uiRoot, 'dist')
const bundleBytes = await fs.readFile(bundlePath)

const modal = new ModalClient({
  tokenId: requireEnv('MODAL_TOKEN_ID'),
  tokenSecret: requireEnv('MODAL_TOKEN_SECRET'),
})

const openAiKey = process.env.OPENAI_API_KEY?.trim() ||
  process.env.WUHU_DEV_OPENAI_API_KEY?.trim() ||
  ''
const ghToken = process.env.GH_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  ''

const app = await modal.apps.fromName(appName, { createIfMissing: true })
let image = modal.images.fromRegistry('node:22-bookworm-slim')
image = image.dockerfileCommands([
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git unzip && rm -rf /var/lib/apt/lists/*',
  'RUN npm install -g @mariozechner/pi-coding-agent@0.51.0',
  'RUN curl -fsSL https://deno.land/install.sh | sh -s v2.6.7',
  'ENV PATH=/root/.deno/bin:$PATH',
  'RUN deno --version',
  'RUN pi --version || true',
])

console.log('Building Modal image...')
const builtImage = await image.build(app)
console.log('Image built:', builtImage.imageId)

console.log('Creating sandbox (1h idle + 1h timeout)...')
const sb = await modal.sandboxes.create(app, builtImage, {
  command: ['sleep', 'infinity'],
  encryptedPorts: [daemonPort, uiPort],
  timeoutMs: oneHour,
  idleTimeoutMs: oneHour,
})

console.log('Sandbox ID:', sb.sandboxId)

await sb.exec(['mkdir', '-p', '/root/wuhu-daemon', '/root/workspace'])
await sb.exec(['mkdir', '-p', '/root/wuhu-ui/dist'])

const remoteBundlePath = '/root/wuhu-daemon/sandbox-daemon.bundle.js'
await uploadFile(sb, remoteBundlePath, bundleBytes)

const serverScript = `import http from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const root = process.env.STATIC_ROOT || '/root/wuhu-ui/dist'
const port = Number(process.env.PORT || 4173)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function sendFile(res, filePath) {
  const ext = extname(filePath)
  res.setHeader('content-type', mime[ext] || 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  let filePath = join(root, pathname)
  try {
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
    return sendFile(res, filePath)
  } catch {
    const fallback = join(root, 'index.html')
    try {
      return sendFile(res, fallback)
    } catch {
      res.statusCode = 404
      res.end('Not found')
    }
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log('UI server listening on', port)
})
`

await uploadDir(sb, uiDist, '/root/wuhu-ui/dist')
await uploadFile(sb, '/root/wuhu-ui/server.mjs', Buffer.from(serverScript))

const jwtEnabled = process.env.SANDBOX_DAEMON_JWT_ENABLED === 'true' ||
  Boolean(process.env.SANDBOX_DAEMON_JWT_SECRET)
const jwtSecret = jwtEnabled
  ? process.env.SANDBOX_DAEMON_JWT_SECRET ||
    crypto.randomBytes(32).toString('hex')
  : null
const jwtIssuer = process.env.SANDBOX_DAEMON_JWT_ISSUER
const now = Math.floor(Date.now() / 1000)
const exp = now + 55 * 60

const adminToken = jwtEnabled
  ? signHs256Jwt(
    {
      sub: 'wuhu',
      scope: 'admin',
      exp,
      ...(jwtIssuer ? { iss: jwtIssuer } : {}),
    },
    jwtSecret,
  )
  : null
const userToken = jwtEnabled
  ? signHs256Jwt(
    {
      sub: 'wuhu',
      scope: 'user',
      exp,
      ...(jwtIssuer ? { iss: jwtIssuer } : {}),
    },
    jwtSecret,
  )
  : null

await sb.exec(['deno', 'run', '-A', remoteBundlePath], {
  env: {
    SANDBOX_DAEMON_HOST: '0.0.0.0',
    SANDBOX_DAEMON_PORT: String(daemonPort),
    SANDBOX_DAEMON_WORKSPACE_ROOT: '/root/workspace',
    SANDBOX_DAEMON_JWT_ENABLED: jwtEnabled ? 'true' : 'false',
    ...(jwtEnabled ? { SANDBOX_DAEMON_JWT_SECRET: jwtSecret } : {}),
    ...(jwtIssuer ? { SANDBOX_DAEMON_JWT_ISSUER: jwtIssuer } : {}),
    ...(openAiKey ? { OPENAI_API_KEY: openAiKey } : {}),
  },
})

await sb.exec(['node', '/root/wuhu-ui/server.mjs'], {
  env: {
    PORT: String(uiPort),
    STATIC_ROOT: '/root/wuhu-ui/dist',
  },
})

await new Promise((resolve) => setTimeout(resolve, 2000))

const tunnels = await sb.tunnels(60_000)
const daemonUrl = tunnels[daemonPort].url.replace(/\/$/, '')
const uiUrl = tunnels[uiPort].url.replace(/\/$/, '')
const uiOrigin = new URL(uiUrl).origin

const initHeaders = {
  'content-type': 'application/json',
  ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
}
const initRes = await fetch(`${daemonUrl}/init`, {
  method: 'POST',
  headers: initHeaders,
  body: JSON.stringify({
    workspace: { repos: [] },
    cors: { allowedOrigins: [uiOrigin] },
  }),
})
if (!initRes.ok) {
  console.error('Init failed:', initRes.status, await initRes.text())
}

if (jwtEnabled && (ghToken || openAiKey)) {
  await fetch(`${daemonUrl}/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      version: 'modal-debug',
      llm: openAiKey ? { openaiApiKey: openAiKey } : undefined,
      github: ghToken ? { token: ghToken } : undefined,
    }),
  })
}

console.log('\n========================================')
console.log('Sandbox daemon ready')
console.log('========================================\n')
console.log('Daemon URL:', daemonUrl)
console.log('UI URL:', uiUrl)
if (jwtEnabled) {
  console.log('ADMIN_BEARER:', adminToken)
  console.log('USER_BEARER:', userToken)
}
