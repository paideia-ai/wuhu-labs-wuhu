import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ModalClient } from 'modal'

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) throw new Error(`Missing env var: ${name}`)
  return value.trim()
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`)
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

async function listFilesRecursive(rootDir) {
  const out = []
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) await walk(abs)
      else if (ent.isFile()) out.push(abs)
    }
  }
  await walk(rootDir)
  return out
}

async function uploadFile(sb, localPath, remotePath) {
  const bytes = await fs.readFile(localPath)
  const f = await sb.open(remotePath, 'w')
  await f.write(bytes)
  await f.flush()
  await f.close()
}

async function waitForDaemon(baseUrl, headers, timeoutMs = 30_000) {
  const start = Date.now()
  // Use a non-follow stream request as a cheap health check.
  const url = `${baseUrl}/stream?cursor=0&follow=0`
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET', headers })
      if (res.ok) return
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`daemon_not_ready: ${url}`)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')

const DAEMON_PORT = 8787
const UI_PORT = 4173
const oneHour = 60 * 60 * 1000
const denoBin = '/root/.deno/bin/deno'

const appName = process.env.WUHU_MODAL_APP_NAME?.trim() ||
  'wuhu-sandbox-daemon-modal-debug'
const denoVersion = process.env.WUHU_MODAL_DENO_VERSION?.trim() || '2.6.7'
const jwtEnabled = process.env.WUHU_MODAL_JWT_ENABLED?.trim() === 'true'
const jwtTtlSeconds = Number(process.env.WUHU_MODAL_JWT_TTL_SECONDS ?? 55 * 60)

const openAiKey = process.env.OPENAI_API_KEY?.trim() ||
  process.env.WUHU_DEV_OPENAI_API_KEY?.trim() ||
  ''
const ghToken = process.env.GH_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() || ''

const modal = new ModalClient({
  tokenId: requireEnv('MODAL_TOKEN_ID'),
  tokenSecret: requireEnv('MODAL_TOKEN_SECRET'),
})

try {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wuhu-modal-'))
  const bundlePath = path.join(tmpDir, 'sandbox-daemon.bundle.js')
  const uiDistDir = path.join(tmpDir, 'sandbox-daemon-ui-dist')

  console.log('Bundling daemon...')
  run('deno', [
    'bundle',
    '--platform=deno',
    '-o',
    bundlePath,
    path.join(repoRoot, 'packages/sandbox-daemon/main.ts'),
  ], { cwd: repoRoot })

  console.log('Building UI...')
  const uiProjectDir = path.join(repoRoot, 'frontend/sandbox-daemon-ui')
  run('bun', ['install'], { cwd: uiProjectDir })
  run('bun', ['run', 'build'], { cwd: uiProjectDir })

  await fs.rm(uiDistDir, { recursive: true, force: true })
  await fs.mkdir(uiDistDir, { recursive: true })
  await fs.cp(path.join(uiProjectDir, 'dist'), uiDistDir, { recursive: true })

  const bundleBytes = await fs.readFile(bundlePath)

  const app = await modal.apps.fromName(appName, { createIfMissing: true })

  let image = modal.images.fromRegistry('node:22-bookworm-slim')
  image = image.dockerfileCommands([
    'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git unzip && rm -rf /var/lib/apt/lists/*',
    'RUN npm install -g @mariozechner/pi-coding-agent@0.51.0',
    `RUN curl -fsSL https://deno.land/install.sh | sh -s v${denoVersion}`,
    'ENV PATH=/root/.deno/bin:$PATH',
    'RUN deno --version',
    'RUN pi --version || true',
  ])

  console.log('Building image...')
  const builtImage = await image.build(app)
  console.log('Image built:', builtImage.imageId)

  console.log('Creating sandbox (1h idleTimeout + 1h timeout)...')
  const sb = await modal.sandboxes.create(app, builtImage, {
    command: ['sleep', 'infinity'],
    encryptedPorts: [DAEMON_PORT, UI_PORT],
    timeoutMs: oneHour,
    idleTimeoutMs: oneHour,
  })

  console.log('Sandbox ID:', sb.sandboxId)

  await sb.exec([
    'bash',
    '-lc',
    [
      'set -euo pipefail',
      'mkdir -p /root/wuhu-daemon /root/wuhu-ui /root/workspace',
    ].join('\n'),
  ])

  const remoteBundlePath = '/root/wuhu-daemon/sandbox-daemon.bundle.js'
  console.log('Uploading daemon bundle...')
  const bundleFile = await sb.open(remoteBundlePath, 'w')
  await bundleFile.write(bundleBytes)
  await bundleFile.flush()
  await bundleFile.close()

  console.log('Uploading UI dist/...')
  const remoteUiDist = '/root/wuhu-ui/dist'
  await sb.exec(['mkdir', '-p', remoteUiDist])

  const localUiFiles = await listFilesRecursive(uiDistDir)
  const createdDirs = new Set([remoteUiDist])
  for (const abs of localUiFiles) {
    const rel = path.relative(uiDistDir, abs)
    const remotePath = `${remoteUiDist}/${rel.replaceAll(path.sep, '/')}`
    const remoteDir = remotePath.split('/').slice(0, -1).join('/')
    if (!createdDirs.has(remoteDir)) {
      await sb.exec(['mkdir', '-p', remoteDir])
      createdDirs.add(remoteDir)
    }
    await uploadFile(sb, abs, remotePath)
  }

  const staticServerPath = '/root/wuhu-ui/server.mjs'
  const staticServerSource = `
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  return args[idx + 1] ?? fallback
}

const port = Number(arg('--port', '4173'))
const dir = arg('--dir', '/root/wuhu-ui/dist')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

function safeJoin(root, p) {
  const clean = p.replace(/\\\\/g, '/').replace(/^\\/+/, '')
  const resolved = path.resolve(root, clean)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)
    const rel = pathname === '/' ? '/index.html' : pathname
    const root = path.resolve(dir)
    const target = safeJoin(root, rel)
    const candidates = target ? [target, path.join(root, 'index.html')] : [path.join(root, 'index.html')]

    for (const file of candidates) {
      try {
        const stat = await fs.stat(file)
        if (!stat.isFile()) continue
        const ext = path.extname(file)
        res.statusCode = 200
        res.setHeader('content-type', mime[ext] || 'application/octet-stream')
        res.end(await fs.readFile(file))
        return
      } catch {
        // continue
      }
    }

    res.statusCode = 404
    res.end('not_found')
  } catch (e) {
    res.statusCode = 500
    res.end(String(e?.message ?? e))
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log('ui listening on', port, 'dir=', dir)
})
`
  console.log('Uploading static server...')
  const serverFile = await sb.open(staticServerPath, 'w')
  await serverFile.write(Buffer.from(staticServerSource, 'utf8'))
  await serverFile.flush()
  await serverFile.close()

  let jwtSecret = ''
  let adminToken = ''
  let userToken = ''
  if (jwtEnabled) {
    jwtSecret = crypto.randomBytes(32).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    adminToken = signHs256Jwt(
      { sub: 'wuhu', scope: 'admin', exp: now + jwtTtlSeconds },
      jwtSecret,
    )
    userToken = signHs256Jwt(
      { sub: 'wuhu', scope: 'user', exp: now + jwtTtlSeconds },
      jwtSecret,
    )
  }

  console.log('Starting daemon...')
  await sb.exec(
    [
      'bash',
      '-lc',
      `nohup ${denoBin} run -A /root/wuhu-daemon/sandbox-daemon.bundle.js > /root/wuhu-daemon/daemon.log 2>&1 & echo $! > /root/wuhu-daemon/daemon.pid`,
    ],
    {
      env: {
        SANDBOX_DAEMON_HOST: '0.0.0.0',
        SANDBOX_DAEMON_PORT: String(DAEMON_PORT),
        SANDBOX_DAEMON_WORKSPACE_ROOT: '/root/workspace',
        SANDBOX_DAEMON_JWT_ENABLED: jwtEnabled ? 'true' : 'false',
        ...(jwtEnabled ? { SANDBOX_DAEMON_JWT_SECRET: jwtSecret } : {}),
        ...(openAiKey ? { OPENAI_API_KEY: openAiKey } : {}),
      },
    },
  )

  console.log('Starting UI...')
  await sb.exec([
    'bash',
    '-lc',
    `nohup node ${staticServerPath} --port ${UI_PORT} --dir ${remoteUiDist} > /root/wuhu-ui/ui.log 2>&1 & echo $! > /root/wuhu-ui/ui.pid`,
  ])

  const tunnels = await sb.tunnels(60_000)
  const daemonBaseUrl = tunnels[DAEMON_PORT].url.replace(/\/$/, '')
  const uiBaseUrl = tunnels[UI_PORT].url.replace(/\/$/, '')

  const authHeader = jwtEnabled ? { authorization: `Bearer ${adminToken}` } : {}

  console.log('Waiting for daemon to accept requests...')
  await waitForDaemon(daemonBaseUrl, authHeader)

  const uiOrigin = new URL(uiBaseUrl).origin

  console.log('Initializing daemon (CORS allowlist + empty workspace)...')
  const initRes = await fetch(`${daemonBaseUrl}/init`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workspace: { repos: [] },
      cors: { allowedOrigins: [uiOrigin] },
    }),
  })
  if (!initRes.ok) {
    const text = await initRes.text()
    throw new Error(
      `init_failed (${initRes.status}): ${text || initRes.statusText}`,
    )
  }

  if (ghToken || openAiKey) {
    const headers = {
      'content-type': 'application/json',
      ...(jwtEnabled ? { authorization: `Bearer ${adminToken}` } : {}),
    }
    console.log('Sending credentials...')
    const res = await fetch(`${daemonBaseUrl}/credentials`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 'modal-debug',
        llm: openAiKey ? { openaiApiKey: openAiKey } : undefined,
        github: ghToken ? { token: ghToken } : undefined,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `credentials_failed (${res.status}): ${text || res.statusText}`,
      )
    }
  }

  const uiWithDaemon = `${uiBaseUrl}/?daemon=${
    encodeURIComponent(daemonBaseUrl)
  }`

  console.log('')
  console.log('Daemon URL:', daemonBaseUrl)
  console.log('UI URL:', uiWithDaemon)
  if (jwtEnabled) {
    console.log('ADMIN_BEARER:', adminToken)
    console.log('USER_BEARER:', userToken)
  }
  console.log('')
  console.log(
    'Sandbox will auto-delete in ~1 hour (timeoutMs + idleTimeoutMs).',
  )
} finally {
  modal.close()
}
