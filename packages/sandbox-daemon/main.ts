import { PiAgentProvider } from './src/pi-agent-provider.ts'
import { createSandboxDaemonApp } from './src/server.ts'

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'

function getPortFromEnv(): number {
  const raw = Deno.env.get('SANDBOX_DAEMON_PORT')
  if (!raw) return DEFAULT_PORT
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}

function getHostFromEnv(): string {
  return Deno.env.get('SANDBOX_DAEMON_HOST') ?? DEFAULT_HOST
}

async function main(): Promise<void> {
  const provider = new PiAgentProvider()
  await provider.start()

  const { app } = createSandboxDaemonApp({ provider })

  const hostname = getHostFromEnv()
  const port = getPortFromEnv()

  Deno.serve(
    {
      hostname,
      port,
      onListen: ({ hostname: listenHost, port: listenPort }): void => {
        // Basic startup log; avoid printing any secrets.
        console.log(
          `Sandbox daemon listening on http://${listenHost}:${listenPort}`,
        )
      },
    },
    (request) => app.fetch(request),
  )
}

if (import.meta.main) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main()
}
