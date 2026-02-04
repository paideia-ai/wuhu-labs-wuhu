const decoder = new TextDecoder()

type Args = {
  image: string
  apiUrl: string
  keyword: string
  port: number
}

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value && !value.startsWith('--')) {
      args.set(key, value)
      i++
    } else {
      args.set(key, 'true')
    }
  }

  const image = (args.get('image') ?? Deno.env.get('SMOKE_IMAGE') ??
    'wuhu-sandbox:latest').trim()
  const apiUrl = (args.get('apiUrl') ?? Deno.env.get('API_URL') ??
    'https://api.wuhu.liu.ms').trim().replace(/\/+$/, '')
  const keyword = (args.get('keyword') ?? 'wuhu').trim()
  const port = Number(args.get('port') ?? Deno.env.get('SMOKE_PORT') ?? 18789)

  return { image, apiUrl, keyword, port }
}

function findFreePort(startPort: number): number {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const listener = Deno.listen({ hostname: '127.0.0.1', port })
      listener.close()
      return port
    } catch {
      // try next
    }
  }
  throw new Error(`could not find free port starting at ${startPort}`)
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(
  cmd: string,
  args: string[],
  options?: { stdout?: 'piped' | 'inherit'; stderr?: 'piped' | 'inherit' },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command(cmd, {
    args,
    stdin: 'null',
    stdout: options?.stdout ?? 'piped',
    stderr: options?.stderr ?? 'piped',
  }).spawn()
  const output = await child.output()
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  }
}

async function waitForHealth(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return
    } catch {
      // ignore
    }
    await sleep(500)
  }
  throw new Error(`sandbox daemon did not become healthy within ${timeoutMs}ms`)
}

async function main() {
  const args = parseArgs(Deno.args)
  const port = findFreePort(args.port)
  const baseUrl = `http://127.0.0.1:${port}`
  const containerName = `wuhu-sandbox-session-query-${Date.now()}`
  const sandboxId = `sb_smoke_${crypto.randomUUID().slice(0, 12)}`

  console.log(`Starting sandbox container ${args.image} on ${baseUrl}...`)
  const container = new Deno.Command('docker', {
    args: [
      'run',
      '--rm',
      '--name',
      containerName,
      '-p',
      `127.0.0.1:${port}:8787`,
      args.image,
    ],
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  try {
    await waitForHealth(baseUrl, 60_000)

    console.log('Initializing sandbox daemon (no repos)...')
    const initRes = await fetch(`${baseUrl}/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sandboxId,
        coreApiUrl: args.apiUrl,
        workspace: { repos: [] },
      }),
    })
    const initText = await initRes.text()
    if (!initRes.ok) {
      throw new Error(`POST /init failed: ${initRes.status} ${initText}`)
    }

    console.log(`Running: wuhu past-sessions query ${JSON.stringify(args.keyword)}`)
    const execRes = await run('docker', [
      'exec',
      containerName,
      'wuhu',
      'past-sessions',
      'query',
      args.keyword,
      '--pretty=false',
    ])
    if (execRes.code !== 0) {
      throw new Error(
        `wuhu CLI failed (code=${execRes.code})\nstdout=${execRes.stdout}\nstderr=${execRes.stderr}`,
      )
    }

    try {
      const parsed = JSON.parse(execRes.stdout)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('unexpected response shape')
      }
    } catch (err) {
      throw new Error(
        `wuhu CLI did not return valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }\nstdout=${execRes.stdout}\nstderr=${execRes.stderr}`,
      )
    }

    console.log('OK: CLI can query sessions from inside the sandbox.')
  } finally {
    console.log('Stopping sandbox container...')
    await run('docker', ['stop', containerName], { stdout: 'inherit', stderr: 'inherit' })
      .catch(() => {})
    await container.status.catch(() => {})
  }
}

if (import.meta.main) {
  await main()
}
