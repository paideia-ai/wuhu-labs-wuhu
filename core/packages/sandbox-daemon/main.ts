import { createSandboxDaemonApp } from './src/server.ts'
import { PiAgentProvider } from './src/pi-agent-provider.ts'
import { MockAgentProvider } from './src/mock-agent-provider.ts'
import {
  applyCredentialsToEnv,
  InMemoryCredentialsStore,
} from './src/credentials.ts'
import { LazyAgentProvider } from './src/lazy-agent-provider.ts'
import { loadSandboxDaemonConfig } from './src/config.ts'
import { readEnvTrimmed } from './src/env.ts'
import { serveDir } from '@std/http/file-server'
import { dirname, join } from '@std/path'

function fileExists(path: string): boolean {
  try {
    const stat = Deno.statSync(path)
    return stat.isFile
  } catch {
    return false
  }
}

function findOnPath(command: string): string | undefined {
  if (command.includes('/')) {
    return fileExists(command) ? command : undefined
  }
  const pathEnv = Deno.env.get('PATH')
  if (!pathEnv) return undefined
  for (const dir of pathEnv.split(':')) {
    const candidate = `${dir}/${command}`
    if (fileExists(candidate)) return candidate
  }
  return undefined
}

function resolvePiInvocation(config: { command?: string; args?: string[] }): {
  command: string
  args?: string[]
} {
  if (config.command) {
    return { command: config.command, args: config.args }
  }

  const onPath = findOnPath('pi')
  if (onPath) {
    return { command: 'pi', args: config.args }
  }

  // Developer fallback: run a locally-built pi CLI from ../pi-mono if present.
  const localPiCli = new URL(
    '../pi-mono/packages/coding-agent/dist/cli.js',
    import.meta.url,
  )
  const localPath = localPiCli.pathname
  if (fileExists(localPath)) {
    return {
      command: 'node',
      args: [localPath, ...(config.args ?? ['--mode', 'rpc', '--no-session'])],
    }
  }

  return { command: 'pi', args: config.args }
}

const config = loadSandboxDaemonConfig()
const hostname = config.host
const port = config.port
const agentMode = config.agentMode

function defaultSessionPath(workspaceRoot?: string): string {
  if (workspaceRoot === '/root' || workspaceRoot?.startsWith('/root/')) {
    return '/root/.wuhu/pi-session.json'
  }
  const home = Deno.env.get('HOME')
  if (home) return join(home, '.wuhu', 'pi-session.json')
  return join(Deno.cwd(), '.wuhu', 'pi-session.json')
}

const sessionPath = config.pi.sessionPath ??
  defaultSessionPath(config.workspaceRoot)
try {
  Deno.mkdirSync(dirname(sessionPath), { recursive: true })
} catch {
  // Best-effort; directory may already exist or not be writable in dev.
}

const previewRoot = Deno.env.get('SANDBOX_DAEMON_PREVIEW_ROOT') ??
  (config.workspaceRoot ? join(config.workspaceRoot, 'repo') : '/root/repo')

const credentials = new InMemoryCredentialsStore()

class InMemoryPiCwdStore {
  #cwd?: string
  #revision = 0

  set(cwd: string | undefined): void {
    if (cwd === this.#cwd) return
    this.#cwd = cwd
    this.#revision++
  }

  get(): { cwd?: string; revision: number } {
    return { cwd: this.#cwd, revision: this.#revision }
  }
}

const piCwdStore = new InMemoryPiCwdStore()

const envOpenAiKey = readEnvTrimmed('OPENAI_API_KEY') ??
  readEnvTrimmed('WUHU_DEV_OPENAI_API_KEY')
const envAnthropicKey = readEnvTrimmed('ANTHROPIC_API_KEY')

if (envOpenAiKey || envAnthropicKey) {
  credentials.set({
    version: 'env',
    llm: {
      openaiApiKey: envOpenAiKey,
      anthropicApiKey: envAnthropicKey,
    },
  })
}

const provider = agentMode === 'mock'
  ? new MockAgentProvider()
  : new LazyAgentProvider({
    getRevision: () => {
      const credRevision = credentials.get().revision
      const cwdRevision = piCwdStore.get().revision
      return credRevision * 1_000_000 + cwdRevision
    },
    create: () => {
      const snapshot = credentials.get()
      const piArgs = config.pi.args ??
        ['--mode', 'rpc', '--session', sessionPath]
      const { command, args } = resolvePiInvocation({
        command: config.pi.command,
        args: piArgs,
      })
      const cwd = piCwdStore.get().cwd
      return new PiAgentProvider({
        command,
        args,
        cwd,
        env: snapshot.env,
      })
    },
  })

const previewPort = 8066
const servers: { main?: Deno.HttpServer; preview?: Deno.HttpServer } = {}
let shuttingDown = false

const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await provider.stop()
  } catch {
    // ignore
  }
  try {
    await Deno.writeTextFile('/tmp/shutdown', new Date().toISOString())
  } catch {
    // ignore
  }
  try {
    servers.preview?.shutdown()
  } catch {
    // ignore
  }
  try {
    servers.main?.shutdown()
  } catch {
    // ignore
  }
}

const { app } = createSandboxDaemonApp({
  provider,
  onCredentials: async (payload) => {
    applyCredentialsToEnv(payload)
    credentials.set(payload)
  },
  onInit: ({ primaryRepo }) => {
    piCwdStore.set(primaryRepo?.absPath)
  },
  auth: config.jwt.enabled
    ? { secret: config.jwt.secret, issuer: config.jwt.issuer, enabled: true }
    : { enabled: false },
  workspaceRoot: config.workspaceRoot,
  onShutdown: shutdown,
})

servers.preview = Deno.serve({
  hostname: '0.0.0.0',
  port: previewPort,
}, async (request) => {
  try {
    const stat = await Deno.stat(previewRoot)
    if (!stat.isDirectory) {
      throw new Error('preview_root_not_directory')
    }
    return await serveDir(request, {
      fsRoot: previewRoot,
      showDirListing: true,
    })
  } catch {
    return new Response(
      `<html><body style="font-family:system-ui;padding:2rem"><h1>Wuhu Sandbox Preview</h1><p>Repo not ready at ${previewRoot}.</p></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }
})

servers.main = Deno.serve({ hostname, port }, app.fetch)

try {
  Deno.addSignalListener('SIGINT', () => void shutdown())
  Deno.addSignalListener('SIGTERM', () => void shutdown())
} catch {
  // Signal listeners may not be available in all environments.
}

console.log(
  `sandbox-daemon listening on http://${hostname}:${port} (agent=${agentMode})`,
)
console.log(`preview server listening on http://0.0.0.0:${previewPort}`)
console.log(`preview root: ${previewRoot}`)
console.log(
  `credentials loaded from env: OPENAI_API_KEY=${
    Boolean(envOpenAiKey)
  } ANTHROPIC_API_KEY=${Boolean(envAnthropicKey)}`,
)

if (servers.main) {
  await servers.main.finished
}
