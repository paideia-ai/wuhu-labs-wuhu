#!/usr/bin/env -S deno run -A

import { PiAgentProvider } from './src/pi-agent-provider.ts'
import { createSandboxDaemonApp } from './src/server.ts'

const PORT = Number(Deno.env.get('SANDBOX_DAEMON_PORT')) || 8080
const HOST = Deno.env.get('SANDBOX_DAEMON_HOST') || '127.0.0.1'

const PI_COMMAND = Deno.env.get('PI_COMMAND') || 'pi'
const PI_PROVIDER = Deno.env.get('PI_PROVIDER') || 'openai'
const PI_MODEL = Deno.env.get('PI_MODEL') || 'gpt-4.1'

// API keys can be passed via environment variables
// Pi reads OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')

console.log(
  `[sandbox-daemon] Starting with provider=${PI_PROVIDER} model=${PI_MODEL}`,
)

// Build environment for Pi process
const piEnv: Record<string, string> = {}
if (OPENAI_API_KEY) piEnv.OPENAI_API_KEY = OPENAI_API_KEY
if (ANTHROPIC_API_KEY) piEnv.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY
if (GOOGLE_API_KEY) piEnv.GOOGLE_API_KEY = GOOGLE_API_KEY

const provider = new PiAgentProvider({
  piCommand: PI_COMMAND,
  piArgs: [
    '--mode',
    'rpc',
    '--no-session',
    '--provider',
    PI_PROVIDER,
    '--model',
    PI_MODEL,
  ],
  env: Object.keys(piEnv).length > 0 ? piEnv : undefined,
})

const { app } = createSandboxDaemonApp({ provider })

await provider.start()

console.log(`[sandbox-daemon] Listening on http://${HOST}:${PORT}`)

Deno.serve({ port: PORT, hostname: HOST }, app.fetch)

// Handle shutdown
Deno.addSignalListener('SIGINT', async () => {
  console.log('\n[sandbox-daemon] Shutting down...')
  await provider.stop()
  Deno.exit(0)
})

Deno.addSignalListener('SIGTERM', async () => {
  console.log('\n[sandbox-daemon] Shutting down...')
  await provider.stop()
  Deno.exit(0)
})
