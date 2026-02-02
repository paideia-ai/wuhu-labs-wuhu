#!/usr/bin/env node
/**
 * Modal Sandbox Daemon Debug Launcher
 *
 * This script:
 * 1. Builds Modal image with Node, Pi, Deno, and Bun
 * 2. Creates a sandbox with 1h auto-delete
 * 3. Bundles and uploads the daemon
 * 4. Builds the UI locally and uploads it
 * 5. Starts daemon on port 8787 and UI on port 4173
 * 6. Configures CORS and credentials
 * 7. Prints URLs and tokens
 *
 * Usage: node scripts/modal-sandbox-daemon-debug.mjs
 *
 * Environment variables:
 *   MODAL_TOKEN_ID / MODAL_TOKEN_SECRET - Modal auth (required)
 *   GH_TOKEN / GITHUB_TOKEN - GitHub token (optional)
 *   OPENAI_API_KEY / WUHU_DEV_OPENAI_API_KEY - OpenAI key (optional)
 *   SANDBOX_DAEMON_JWT_ENABLED - Set to "false" to disable JWT (default: false for dev)
 */

import crypto from 'node:crypto'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ============================================================================
// Utilities
// ============================================================================

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) throw new Error(`Missing env var: ${name}`)
  return value.trim()
}

function optionalEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
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

async function exec(cmd, opts = {}) {
  console.log(`[exec] ${cmd}`)
  return execSync(cmd, { stdio: 'inherit', ...opts })
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Modal Sandbox Daemon Debug Launcher ===\n')

  // Check for Modal SDK
  let ModalClient
  try {
    const modal = await import('modal')
    ModalClient = modal.ModalClient
  } catch (e) {
    console.error('Modal SDK not found. Install with: npm install modal')
    process.exit(1)
  }

  // Load environment
  const modalTokenId = requireEnv('MODAL_TOKEN_ID')
  const modalTokenSecret = requireEnv('MODAL_TOKEN_SECRET')
  const ghToken = optionalEnv('GH_TOKEN', 'GITHUB_TOKEN')
  const openAiKey = optionalEnv('OPENAI_API_KEY', 'WUHU_DEV_OPENAI_API_KEY')
  const jwtEnabled = process.env.SANDBOX_DAEMON_JWT_ENABLED !== 'false'

  console.log(`JWT enabled: ${jwtEnabled}`)
  console.log(`GitHub token: ${ghToken ? 'yes' : 'no'}`)
  console.log(`OpenAI key: ${openAiKey ? 'yes' : 'no'}\n`)

  // Step 1: Bundle the daemon
  console.log('[1/7] Bundling daemon...')
  const bundlePath = '/tmp/sandbox-daemon.bundle.js'
  const daemonMainTs = path.join(repoRoot, 'packages/sandbox-daemon/main.ts')
  exec(`deno bundle --platform=deno -o ${bundlePath} ${daemonMainTs}`)
  const bundleBytes = await fs.readFile(bundlePath)
  console.log(`Bundle size: ${Math.round(bundleBytes.length / 1024)}KB\n`)

  // Step 2: Build the UI
  console.log('[2/7] Building UI...')
  const uiDir = path.join(repoRoot, 'frontend/sandbox-daemon-ui')
  try {
    exec('bun install', { cwd: uiDir })
    exec('bun run build', { cwd: uiDir })
  } catch (e) {
    console.error('Failed to build UI. Make sure bun is installed.')
    process.exit(1)
  }
  const uiDistDir = path.join(uiDir, 'dist')
  console.log(`UI built at: ${uiDistDir}\n`)

  // Step 3: Create Modal client and image
  console.log('[3/7] Creating Modal image...')
  const modal = new ModalClient({
    tokenId: modalTokenId,
    tokenSecret: modalTokenSecret,
  })

  const app = await modal.apps.fromName('wuhu-sandbox-daemon-debug', {
    createIfMissing: true,
  })

  let image = modal.images.fromRegistry('node:22-bookworm-slim')
  image = image.dockerfileCommands([
    // Install system dependencies
    'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git unzip && rm -rf /var/lib/apt/lists/*',
    // Install Pi first
    'RUN npm install -g @mariozechner/pi-coding-agent@0.51.0',
    // Install Deno
    'RUN curl -fsSL https://deno.land/install.sh | sh -s v2.6.7',
    'ENV PATH=/root/.deno/bin:$PATH',
    // Install Bun (for serving static UI)
    'RUN curl -fsSL https://bun.sh/install | bash',
    'ENV PATH=/root/.bun/bin:$PATH',
    // Verify installations
    'RUN deno --version && pi --version || true && bun --version',
  ])

  console.log('Building Modal image (this may take a few minutes)...')
  const builtImage = await image.build(app)
  console.log(`Image built: ${builtImage.imageId}\n`)

  // Step 4: Create sandbox
  console.log('[4/7] Creating sandbox (1h timeout)...')
  const DAEMON_PORT = 8787
  const UI_PORT = 4173
  const oneHour = 60 * 60 * 1000

  const sb = await modal.sandboxes.create(app, builtImage, {
    command: ['sleep', 'infinity'],
    encryptedPorts: [DAEMON_PORT, UI_PORT],
    timeoutMs: oneHour,
    idleTimeoutMs: oneHour,
  })
  console.log(`Sandbox ID: ${sb.sandboxId}\n`)

  // Step 5: Upload daemon and UI files
  console.log('[5/7] Uploading files...')
  await sb.exec([
    'mkdir',
    '-p',
    '/root/wuhu-daemon',
    '/root/workspace',
    '/root/ui',
  ])

  // Upload daemon bundle
  const remoteBundlePath = '/root/wuhu-daemon/sandbox-daemon.bundle.js'
  const bundleFile = await sb.open(remoteBundlePath, 'w')
  await bundleFile.write(bundleBytes)
  await bundleFile.flush()
  await bundleFile.close()
  console.log(`Uploaded daemon bundle to ${remoteBundlePath}`)

  // Upload UI files
  const uploadDir = async (localDir, remoteDir) => {
    const entries = await fs.readdir(localDir, { withFileTypes: true })
    for (const entry of entries) {
      const localPath = path.join(localDir, entry.name)
      const remotePath = `${remoteDir}/${entry.name}`
      if (entry.isDirectory()) {
        await sb.exec(['mkdir', '-p', remotePath])
        await uploadDir(localPath, remotePath)
      } else {
        const content = await fs.readFile(localPath)
        const f = await sb.open(remotePath, 'w')
        await f.write(content)
        await f.flush()
        await f.close()
      }
    }
  }
  await uploadDir(uiDistDir, '/root/ui')
  console.log('Uploaded UI files to /root/ui\n')

  // Step 6: Start daemon and UI server
  console.log('[6/7] Starting services...')

  // Generate JWT secret and tokens
  const jwtSecret = crypto.randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const adminToken = jwtEnabled
    ? signHs256Jwt(
      { sub: 'wuhu-admin', scope: 'admin', exp: now + 55 * 60 },
      jwtSecret,
    )
    : ''
  const userToken = jwtEnabled
    ? signHs256Jwt(
      { sub: 'wuhu-user', scope: 'user', exp: now + 55 * 60 },
      jwtSecret,
    )
    : ''

  // Start daemon
  const daemonEnv = {
    SANDBOX_DAEMON_HOST: '0.0.0.0',
    SANDBOX_DAEMON_PORT: String(DAEMON_PORT),
    SANDBOX_DAEMON_WORKSPACE_ROOT: '/root/workspace',
    SANDBOX_DAEMON_JWT_ENABLED: String(jwtEnabled),
    ...(jwtEnabled ? { SANDBOX_DAEMON_JWT_SECRET: jwtSecret } : {}),
    ...(openAiKey ? { OPENAI_API_KEY: openAiKey } : {}),
    PATH: '/root/.deno/bin:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin',
  }

  console.log('Starting daemon on port', DAEMON_PORT, '...')
  await sb.exec(['deno', 'run', '-A', remoteBundlePath], { env: daemonEnv })

  // Start simple static file server for UI using Bun
  console.log('Starting UI server on port', UI_PORT, '...')
  const serveScript = `
    import { serve, file } from "bun";
    import { join } from "path";

    const PORT = ${UI_PORT};
    const ROOT = "/root/ui";

    serve({
      port: PORT,
      hostname: "0.0.0.0",
      async fetch(req) {
        const url = new URL(req.url);
        let pathname = url.pathname;
        if (pathname === "/") pathname = "/index.html";

        const filePath = join(ROOT, pathname);
        const f = file(filePath);
        if (await f.exists()) {
          return new Response(f);
        }
        // SPA fallback
        return new Response(file(join(ROOT, "index.html")));
      },
    });
    console.log("UI server listening on port", PORT);
  `
  const serveScriptPath = '/root/ui-server.ts'
  const serveFile = await sb.open(serveScriptPath, 'w')
  await serveFile.write(Buffer.from(serveScript))
  await serveFile.flush()
  await serveFile.close()

  await sb.exec(['bun', 'run', serveScriptPath], {
    env: { PATH: '/root/.bun/bin:/usr/local/bin:/usr/bin:/bin' },
  })

  // Wait for services to start
  console.log('Waiting for services to start...')
  await sleep(3000)

  // Get tunnel URLs
  console.log('Getting tunnel URLs...')
  const tunnels = await sb.tunnels(60_000)
  const daemonUrl = tunnels[DAEMON_PORT].url.replace(/\/$/, '')
  const uiUrl = tunnels[UI_PORT].url.replace(/\/$/, '')

  console.log('\n')

  // Step 7: Initialize daemon with CORS config
  console.log('[7/7] Initializing daemon...')
  const initPayload = {
    workspace: { repos: [] },
    cors: { allowedOrigins: [uiUrl] },
  }

  const initHeaders = {
    'Content-Type': 'application/json',
    ...(jwtEnabled ? { Authorization: `Bearer ${adminToken}` } : {}),
  }

  let initSuccess = false
  for (let i = 0; i < 5; i++) {
    try {
      const initRes = await fetch(`${daemonUrl}/init`, {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify(initPayload),
      })
      if (initRes.ok) {
        const data = await initRes.json()
        console.log('Init response:', data)
        initSuccess = true
        break
      } else {
        console.log(`Init attempt ${i + 1} failed: HTTP ${initRes.status}`)
      }
    } catch (e) {
      console.log(`Init attempt ${i + 1} failed:`, e.message)
    }
    await sleep(2000)
  }

  if (!initSuccess) {
    console.error('Failed to initialize daemon after multiple attempts')
  }

  // Send credentials if available
  if (ghToken || openAiKey) {
    const credentialsPayload = {
      version: 'modal-debug',
      ...(openAiKey ? { llm: { openaiApiKey: openAiKey } } : {}),
      ...(ghToken ? { github: { token: ghToken } } : {}),
    }
    try {
      const credRes = await fetch(`${daemonUrl}/credentials`, {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify(credentialsPayload),
      })
      if (credRes.ok) {
        console.log('Credentials configured successfully')
      } else {
        console.log('Failed to configure credentials:', await credRes.text())
      }
    } catch (e) {
      console.log('Failed to configure credentials:', e.message)
    }
  }

  // Print final info
  console.log('\n' + '='.repeat(60))
  console.log('SANDBOX READY!')
  console.log('='.repeat(60))
  console.log()
  console.log('UI URL (open in browser):')
  console.log(`  ${uiUrl}`)
  console.log()
  console.log('Daemon URL:')
  console.log(`  ${daemonUrl}`)
  console.log()

  if (jwtEnabled) {
    console.log('JWT Tokens (valid for ~55 minutes):')
    console.log()
    console.log('Admin token (for /credentials, /init):')
    console.log(`  ${adminToken}`)
    console.log()
    console.log('User token (for /prompt, /abort, /stream):')
    console.log(`  ${userToken}`)
    console.log()
  } else {
    console.log('JWT is DISABLED (dev mode)')
    console.log('No token needed for API calls')
    console.log()
  }

  console.log('Sandbox ID:', sb.sandboxId)
  console.log('Auto-delete in: 1 hour')
  console.log()
  console.log('='.repeat(60))
  console.log()
  console.log('Quick test commands:')
  console.log()
  console.log('# Stream events (in another terminal):')
  if (jwtEnabled) {
    console.log(
      `curl -N -H "Authorization: Bearer ${userToken}" "${daemonUrl}/stream?cursor=0&follow=1"`,
    )
  } else {
    console.log(`curl -N "${daemonUrl}/stream?cursor=0&follow=1"`)
  }
  console.log()
  console.log('# Send a prompt:')
  if (jwtEnabled) {
    console.log(
      `curl -X POST -H "Authorization: Bearer ${userToken}" -H "Content-Type: application/json" -d '{"message":"Hello!"}' "${daemonUrl}/prompt"`,
    )
  } else {
    console.log(
      `curl -X POST -H "Content-Type: application/json" -d '{"message":"Hello!"}' "${daemonUrl}/prompt"`,
    )
  }
  console.log()

  // Keep process alive
  console.log('Press Ctrl+C to exit (sandbox will continue running)...')
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
