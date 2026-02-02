import { createSandboxDaemonApp } from './src/server.ts'
import { FakeAgentProvider } from './src/agent-provider.ts'
import { PiAgentProvider } from './src/pi-agent-provider.ts'
import { InMemoryCredentialsStore } from './src/credentials.ts'
import { LazyAgentProvider } from './src/lazy-agent-provider.ts'
import { readEnvNumber, readEnvString, readEnvTrimmed } from './src/env.ts'

function parseArgsEnv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed
      }
    } catch {
      // Fall through to whitespace split.
    }
  }
  return trimmed.split(/\s+/g).filter(Boolean)
}

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

function resolvePiInvocation(): { command: string; args?: string[] } {
  const explicitCommand = readEnvTrimmed('SANDBOX_DAEMON_PI_COMMAND')
  const explicitArgs = parseArgsEnv(readEnvTrimmed('SANDBOX_DAEMON_PI_ARGS'))

  if (explicitCommand) {
    return { command: explicitCommand, args: explicitArgs }
  }

  const onPath = findOnPath('pi')
  if (onPath) {
    return { command: 'pi', args: explicitArgs }
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
      args: [localPath, ...(explicitArgs ?? ['--mode', 'rpc', '--no-session'])],
    }
  }

  return { command: 'pi', args: explicitArgs }
}

const hostname = readEnvString('SANDBOX_DAEMON_HOST', '127.0.0.1')
const port = readEnvNumber('SANDBOX_DAEMON_PORT', 8787)
const agentMode = readEnvString('SANDBOX_DAEMON_AGENT_MODE', 'pi-rpc')

const credentials = new InMemoryCredentialsStore()

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
  ? new FakeAgentProvider()
  : new LazyAgentProvider({
    getRevision: () => credentials.get().revision,
    create: () => {
      const snapshot = credentials.get()
      const { command, args } = resolvePiInvocation()
      const cwd = readEnvTrimmed('SANDBOX_DAEMON_PI_CWD')
      return new PiAgentProvider({
        command,
        args,
        cwd,
        env: snapshot.env,
      })
    },
  })

const { app } = createSandboxDaemonApp({
  provider,
  onCredentials: async (payload) => {
    credentials.set(payload)
    await provider.start()
  },
})

try {
  await provider.start()
} catch {
  console.error(
    'sandbox-daemon: agent provider failed to start (install `pi` or set SANDBOX_DAEMON_AGENT_MODE=mock)',
  )
}

const server = Deno.serve({ hostname, port }, app.fetch)

const shutdown = async () => {
  try {
    await provider.stop()
  } finally {
    server.shutdown()
  }
}

try {
  Deno.addSignalListener('SIGINT', () => void shutdown())
  Deno.addSignalListener('SIGTERM', () => void shutdown())
} catch {
  // Signal listeners may not be available in all environments.
}

console.log(
  `sandbox-daemon listening on http://${hostname}:${port} (agent=${agentMode})`,
)
console.log(
  `credentials loaded from env: OPENAI_API_KEY=${
    Boolean(envOpenAiKey)
  } ANTHROPIC_API_KEY=${Boolean(envAnthropicKey)}`,
)

await server.finished
