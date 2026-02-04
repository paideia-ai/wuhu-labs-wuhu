import { join } from '@std/path'

export type WuhuCliResult = {
  code: number
}

export type WuhuCliDeps = {
  env: Record<string, string | undefined>
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  isTty: boolean
  writeStdout: (text: string) => void | Promise<void>
  writeStderr: (text: string) => void | Promise<void>
}

type ParsedFlags = {
  apiUrl?: string
  pretty?: boolean
  limit?: number
  offset?: number
  help?: boolean
}

function usage(): string {
  return `Usage:
  wuhu past-sessions query <query> [--limit N] [--offset N] [--api-url URL]
  wuhu past-sessions get <session-id> [--api-url URL]
`
}

function parseFlags(argv: string[]): { flags: ParsedFlags; rest: string[] } {
  const flags: ParsedFlags = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const raw = arg.slice(2)
    const eqIndex = raw.indexOf('=')
    const key = eqIndex >= 0 ? raw.slice(0, eqIndex) : raw
    const inlineValue = eqIndex >= 0 ? raw.slice(eqIndex + 1) : undefined
    const next = argv[i + 1]
    const value = inlineValue ??
      (next && !next.startsWith('--') ? next : undefined)
    if (inlineValue === undefined && value) i++

    if (key === 'help' || key === 'h') {
      flags.help = true
      continue
    }
    if (key === 'api-url' || key === 'apiUrl') {
      flags.apiUrl = value
      continue
    }
    if (key === 'pretty') {
      flags.pretty = value ? value !== 'false' : true
      continue
    }
    if (key === 'limit') {
      flags.limit = value ? Number(value) : undefined
      continue
    }
    if (key === 'offset') {
      flags.offset = value ? Number(value) : undefined
      continue
    }

    // Unknown flags are forwarded to the rest args to avoid breaking callers.
    rest.push(arg)
    if (value) rest.push(value)
  }
  return { flags, rest }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function defaultCliConfigPath(env: Record<string, string | undefined>): string {
  const explicit = env.WUHU_CLI_CONFIG_PATH?.trim()
  if (explicit) return explicit
  const home = env.HOME?.trim()
  if (home) return join(home, '.wuhu', 'core.json')
  return join(Deno.cwd(), '.wuhu', 'core.json')
}

async function readCoreApiUrlFromConfig(
  configPath: string,
): Promise<string | undefined> {
  try {
    const raw = await Deno.readTextFile(configPath)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const coreApiUrl = typeof parsed.coreApiUrl === 'string'
      ? parsed.coreApiUrl.trim()
      : ''
    return coreApiUrl ? coreApiUrl : undefined
  } catch {
    return undefined
  }
}

async function resolveApiUrl(
  flags: ParsedFlags,
  deps: WuhuCliDeps,
): Promise<string> {
  const fromFlag = flags.apiUrl?.trim()
  if (fromFlag) return normalizeBaseUrl(fromFlag)
  const env = deps.env
  const fromEnv = env.WUHU_CORE_API_URL?.trim() || env.CORE_API_URL?.trim() ||
    env.WUHU_API_URL?.trim() || env.API_URL?.trim()
  if (fromEnv) return normalizeBaseUrl(fromEnv)
  const configPath = defaultCliConfigPath(env)
  const fromConfig = await readCoreApiUrlFromConfig(configPath)
  if (fromConfig) return normalizeBaseUrl(fromConfig)
  return 'https://api.wuhu.liu.ms'
}

async function writeJson(
  value: unknown,
  deps: WuhuCliDeps,
  flags: ParsedFlags,
): Promise<void> {
  const pretty = flags.pretty ?? deps.isTty
  const text = JSON.stringify(value, null, pretty ? 2 : undefined) + '\n'
  await deps.writeStdout(text)
}

async function fetchJson(
  url: string,
  init: RequestInit,
  deps: WuhuCliDeps,
): Promise<{ ok: true; body: unknown } | { ok: false; code: number }> {
  let res: Response
  try {
    res = await deps.fetchFn(url, init)
  } catch (error) {
    await deps.writeStderr(
      `wuhu: request failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    )
    return { ok: false, code: 1 }
  }

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    await deps.writeStderr(
      `wuhu: ${res.status} ${res.statusText}${text ? `: ${text}` : ''}\n`,
    )
    return { ok: false, code: 1 }
  }

  if (!text.trim()) return { ok: true, body: null }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: true, body: text }
  }
}

export async function runWuhuCli(
  argv: string[],
  deps: WuhuCliDeps,
): Promise<WuhuCliResult> {
  const { flags, rest } = parseFlags(argv)

  if (flags.help || rest.length === 0) {
    await deps.writeStdout(usage())
    return { code: 0 }
  }

  const [command, subcommand, ...args] = rest
  if (command !== 'past-sessions') {
    await deps.writeStderr(`wuhu: unknown command ${JSON.stringify(command)}\n`)
    await deps.writeStdout(usage())
    return { code: 1 }
  }

  const baseUrl = await resolveApiUrl(flags, deps)

  if (subcommand === 'query') {
    const query = args.join(' ').trim()
    if (!query) {
      await deps.writeStderr('wuhu: query is required\n')
      await deps.writeStdout(usage())
      return { code: 1 }
    }
    const limit = Number.isFinite(flags.limit ?? NaN)
      ? Math.max(0, Math.floor(flags.limit!))
      : undefined
    const offset = Number.isFinite(flags.offset ?? NaN)
      ? Math.max(0, Math.floor(flags.offset!))
      : undefined
    const body = {
      query,
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(typeof offset === 'number' ? { offset } : {}),
    }
    const res = await fetchJson(`${baseUrl}/sessions/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, deps)
    if (!res.ok) return { code: res.code }
    await writeJson(res.body, deps, flags)
    return { code: 0 }
  }

  if (subcommand === 'get') {
    const id = (args[0] ?? '').trim()
    if (!id) {
      await deps.writeStderr('wuhu: session id is required\n')
      await deps.writeStdout(usage())
      return { code: 1 }
    }
    const res = await fetchJson(
      `${baseUrl}/sessions/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      deps,
    )
    if (!res.ok) return { code: res.code }
    await writeJson(res.body, deps, flags)
    return { code: 0 }
  }

  await deps.writeStderr(
    `wuhu: unknown subcommand ${JSON.stringify(subcommand)}\n`,
  )
  await deps.writeStdout(usage())
  return { code: 1 }
}
