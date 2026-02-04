const decoder = new TextDecoder()

type Args = {
  apiUrl: string
  id?: string
  repo?: string
  name?: string
  prompt?: string
  cursor: number
  interactive: boolean
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

  const apiUrl = (args.get('apiUrl') ?? Deno.env.get('API_URL') ??
    'https://api.wuhu.liu.ms').trim().replace(/\/+$/, '')
  const cursor = Number(args.get('cursor') ?? '0') || 0
  const interactive = (args.get('interactive') ?? 'false').toLowerCase() ===
    'true'

  return {
    apiUrl,
    id: args.get('id')?.trim() || undefined,
    repo: args.get('repo')?.trim() || undefined,
    name: args.get('name')?.trim() || undefined,
    prompt: args.get('prompt')?.trim() || undefined,
    cursor,
    interactive,
  }
}

function parseSseChunk(chunk: string): { data?: string; event?: string } {
  const lines = chunk.split(/\r?\n/)
  const dataLines: string[] = []
  let event: string | undefined
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trimStart()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  const data = dataLines.length ? dataLines.join('\n') : undefined
  return { data, event }
}

async function createSandbox(args: Args): Promise<{ id: string }> {
  if (!args.repo) {
    throw new Error('Missing --repo (e.g. --repo wuhu-labs/wuhu)')
  }
  const prompt = args.prompt?.trim() || 'Tell me what this repo is about'
  const res = await fetch(`${args.apiUrl}/sandboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: args.repo,
      name: args.name,
      prompt,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST /sandboxes failed: ${res.status} ${text}`)
  }
  const json = await res.json()
  const sandbox = json?.sandbox
  if (!sandbox?.id) throw new Error('Core returned invalid sandbox payload')
  return { id: String(sandbox.id) }
}

async function sendPrompt(
  args: Args,
  id: string,
  message: string,
): Promise<void> {
  const res = await fetch(`${args.apiUrl}/sandboxes/${id}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST /sandboxes/${id}/prompt failed: ${res.status} ${text}`)
  }
}

async function streamEndpoint(
  url: string,
  label: 'control' | 'coding',
  onEnvelope: (envelope: { cursor: number; event: any }) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${label} stream failed: ${res.status} ${text}`)
  }

  const reader = res.body.getReader()
  let buffer = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      if (!part.trim()) continue
      const parsed = parseSseChunk(part)
      if (!parsed.data) continue
      if (parsed.event === 'heartbeat') continue
      let envelope: any
      try {
        envelope = JSON.parse(parsed.data)
      } catch {
        continue
      }
      const cursor = typeof envelope?.cursor === 'number' ? envelope.cursor : 0
      if (!cursor) continue
      onEnvelope({ cursor, event: envelope.event })
    }
  }
  try {
    await reader.cancel()
  } catch {
    // ignore
  }
}

async function readStdinLines(
  onLine: (line: string) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const stdin = Deno.stdin.readable
  const reader = stdin.getReader()
  let buf = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      await onLine(trimmed)
    }
  }
  try {
    await reader.cancel()
  } catch {
    // ignore
  }
}

async function main() {
  const args = parseArgs(Deno.args)

  const creating = Boolean(args.repo) && !args.id
  const followup = Boolean(args.id) && Boolean(args.prompt) && !args.repo

  let id = args.id
  if (creating) {
    console.log(`Creating sandbox (repo=${args.repo})...`)
    const created = await createSandbox(args)
    id = created.id
    console.log(`Sandbox created: ${id}`)
  }
  if (!id) {
    throw new Error('Missing --id or --repo')
  }

  const shouldExitOnTurnEnd = creating || followup

  if (followup) {
    console.log(`Sending prompt to sandbox ${id}...`)
    await sendPrompt(args, id, args.prompt!)
  }

  const cursor = args.cursor
  const controlUrl =
    `${args.apiUrl}/sandboxes/${id}/stream/control?cursor=${cursor}`
  const codingUrl =
    `${args.apiUrl}/sandboxes/${id}/stream/coding?cursor=${cursor}`

  const controller = new AbortController()
  const signal = controller.signal

  let lastCursor = cursor
  let turnEndSeen = false

  const print = (label: 'control' | 'coding', env: { cursor: number; event: any }) => {
    lastCursor = Math.max(lastCursor, env.cursor)
    console.log(`[${label}] ${JSON.stringify(env)}`)
  }

  const controlPromise = streamEndpoint(
    controlUrl,
    'control',
    (env) => print('control', env),
    signal,
  )
  const codingPromise = streamEndpoint(
    codingUrl,
    'coding',
    (env) => {
      print('coding', env)
      if (env?.event?.type === 'turn_end') {
        turnEndSeen = true
        if (shouldExitOnTurnEnd) controller.abort()
      }
    },
    signal,
  )

  const stdinPromise = args.interactive
    ? readStdinLines(async (line) => {
      await sendPrompt(args, id!, line)
      console.log(`[prompt] sent (cursor>=${lastCursor})`)
    }, signal)
    : Promise.resolve()

  try {
    await Promise.race([
      Promise.all([controlPromise, codingPromise, stdinPromise]),
      new Promise<void>((resolve) => {
        const handler = () => {
          controller.abort()
          resolve()
        }
        try {
          Deno.addSignalListener('SIGINT', handler)
          Deno.addSignalListener('SIGTERM', handler)
        } catch {
          // ignore
        }
      }),
    ])
  } finally {
    controller.abort()
  }

  if (shouldExitOnTurnEnd && !turnEndSeen) {
    throw new Error('stream ended before turn_end was observed')
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    Deno.exit(1)
  }
}

