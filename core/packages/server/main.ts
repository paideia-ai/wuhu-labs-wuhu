import { Hono } from '@hono/hono'
import type { Context } from '@hono/hono'
import { cors } from '@hono/hono/cors'
import { loadConfig } from './src/config.ts'
import { createKubeClient } from './src/k8s.ts'
import type { SandboxRecord } from './src/sandbox-service.ts'
import { RepoService } from './src/repos.ts'
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  refreshSandboxes,
  refreshSandboxPod,
  terminateSandbox,
} from './src/sandbox-service.ts'

const app = new Hono()
const config = loadConfig()
const kubeClientPromise = createKubeClient(config.kube)
const repoService = new RepoService({
  token: config.github.token,
  allowedOrgs: config.github.allowedOrgs,
  redisUrl: config.redis.url,
})

app.use('*', cors())

function parsePreviewHost(host: string): { id: string; port: number } | null {
  const hostname = host.split(':')[0]
  const suffix = `.${config.sandbox.previewDomain}`
  if (!hostname.endsWith(suffix)) return null
  const prefix = hostname.slice(0, -suffix.length)
  const dashIndex = prefix.lastIndexOf('-')
  if (dashIndex <= 0) return null
  const id = prefix.slice(0, dashIndex)
  const port = Number(prefix.slice(dashIndex + 1))
  if (!Number.isInteger(port)) return null
  return { id, port }
}

async function proxyPreviewRequest(c: Context): Promise<Response | null> {
  const host = c.req.header('host') ?? c.req.header('Host')
  if (!host) return null
  const parsed = parsePreviewHost(host)
  if (!parsed) return null

  const kubeClient = await kubeClientPromise
  const record = await getSandbox(parsed.id)
  if (!record) {
    return c.json({ error: 'sandbox_not_found' }, 404)
  }
  const refreshed = await refreshSandboxPod(kubeClient, record)
  if (!refreshed.podIp) {
    return c.json({ error: 'pod_not_ready' }, 503)
  }
  if (parsed.port !== refreshed.previewPort) {
    return c.json({ error: 'preview_port_mismatch' }, 404)
  }

  const targetUrl = new URL(c.req.url)
  targetUrl.protocol = 'http:'
  targetUrl.hostname = refreshed.podIp
  targetUrl.port = String(parsed.port)

  const headers = new Headers(c.req.raw.headers)
  headers.delete('host')

  const response = await fetch(targetUrl.toString(), {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
    redirect: 'manual',
  })

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

app.use('*', async (c, next) => {
  const proxied = await proxyPreviewRequest(c)
  if (proxied) return proxied
  await next()
})

function buildPreviewUrl(id: string, port: number): string {
  return `https://${id}-${port}.${config.sandbox.previewDomain}`
}

function serializeSandbox(record: SandboxRecord) {
  return {
    ...record,
    previewUrl: buildPreviewUrl(record.id, record.previewPort),
  }
}

async function tryShutdownDaemon(record: {
  podIp: string | null
  daemonPort: number
}) {
  if (!record.podIp) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    await fetch(`http://${record.podIp}:${record.daemonPort}/shutdown`, {
      method: 'POST',
      signal: controller.signal,
    })
  } catch {
    // best-effort
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForSandboxReady(
  client: Awaited<ReturnType<typeof createKubeClient>>,
  record: SandboxRecord,
  options?: { attempts?: number; delayMs?: number },
): Promise<SandboxRecord> {
  const attempts = options?.attempts ?? 30
  const delayMs = options?.delayMs ?? 1000
  let current = record
  for (let i = 0; i < attempts; i++) {
    current = await refreshSandboxPod(client, current)
    if (current.podIp) return current
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return current
}

async function postDaemonCredentials(
  record: { podIp: string | null; daemonPort: number },
  token: string | undefined,
): Promise<void> {
  if (!record.podIp || !token) return
  try {
    const response = await fetch(
      `http://${record.podIp}:${record.daemonPort}/credentials`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 'core',
          github: { token },
        }),
      },
    )
    if (!response.ok) {
      console.warn('sandbox credentials failed', await response.text())
    }
  } catch (error) {
    console.warn('sandbox credentials request failed', error)
  }
}

async function initSandboxRepo(
  record: { podIp: string | null; daemonPort: number },
  repoFullName: string,
): Promise<void> {
  if (!record.podIp) return
  try {
    const response = await fetch(
      `http://${record.podIp}:${record.daemonPort}/init`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace: {
            repos: [
              {
                id: repoFullName,
                source: `github:${repoFullName}`,
                path: 'repo',
              },
            ],
          },
        }),
      },
    )
    if (!response.ok) {
      console.warn('sandbox init failed', await response.text())
    }
  } catch (error) {
    console.warn('sandbox init request failed', error)
  }
}

app.get('/', (c) => {
  return c.json({
    name: 'wuhu-core',
    version: '0.1.0',
    sandboxImage: config.sandbox.image,
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.get('/repos', async (c) => {
  try {
    const repos = await repoService.listRepos()
    return c.json({ repos })
  } catch (error) {
    console.error('Failed to list repos', error)
    const message = error instanceof Error ? error.message : 'repo_list_failed'
    return c.json({ error: message }, 500)
  }
})

app.get('/sandboxes', async (c) => {
  const includeTerminated = c.req.query('all') === 'true'
  const refresh = c.req.query('refresh') !== 'false'
  try {
    const kubeClient = await kubeClientPromise
    let records = await listSandboxes({ includeTerminated })
    if (refresh) {
      records = await refreshSandboxes(kubeClient, records)
    }
    return c.json({
      sandboxes: records.map((record) => serializeSandbox(record)),
    })
  } catch (error) {
    console.error('Failed to list sandboxes', error)
    return c.json({ error: 'sandbox_list_failed' }, 500)
  }
})

app.post('/sandboxes', async (c) => {
  let body: { name?: string; repo?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  try {
    const repo = String(body.repo ?? '').trim()
    if (!repo) {
      return c.json({ error: 'missing_repo' }, 400)
    }
    const repoParts = repo.split('/')
    if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
      return c.json({ error: 'invalid_repo' }, 400)
    }
    if (
      config.github.allowedOrgs.length > 0 &&
      !config.github.allowedOrgs.includes(repoParts[0])
    ) {
      return c.json({ error: 'repo_not_allowed' }, 400)
    }
    const kubeClient = await kubeClientPromise
    const { record } = await createSandbox(kubeClient, config.sandbox, {
      name: body.name ?? null,
      repoFullName: repo,
    })
    void (async () => {
      const ready = await waitForSandboxReady(kubeClient, record)
      if (!ready.podIp) {
        console.warn('sandbox pod did not become ready in time', record.id)
        return
      }
      await postDaemonCredentials(ready, config.github.token)
      await initSandboxRepo(ready, repo)
    })()
    return c.json({ sandbox: serializeSandbox(record) }, 201)
  } catch (error) {
    console.error('Failed to create sandbox', error)
    return c.json({ error: 'sandbox_create_failed' }, 500)
  }
})

app.get('/sandboxes/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const kubeClient = await kubeClientPromise
    const record = await getSandbox(id)
    if (!record) {
      return c.json({ error: 'not_found' }, 404)
    }
    const refreshed = await refreshSandboxPod(kubeClient, record)
    return c.json({ sandbox: serializeSandbox(refreshed) })
  } catch (error) {
    console.error('Failed to fetch sandbox', error)
    return c.json({ error: 'sandbox_fetch_failed' }, 500)
  }
})

app.post('/sandboxes/:id/kill', async (c) => {
  const id = c.req.param('id')
  try {
    const kubeClient = await kubeClientPromise
    const record = await getSandbox(id)
    if (!record) {
      return c.json({ error: 'not_found' }, 404)
    }
    const refreshed = await refreshSandboxPod(kubeClient, record)
    await tryShutdownDaemon(refreshed)
    const terminated = await terminateSandbox(kubeClient, refreshed)
    return c.json({ sandbox: serializeSandbox(terminated) })
  } catch (error) {
    console.error('Failed to terminate sandbox', error)
    return c.json({ error: 'sandbox_kill_failed' }, 500)
  }
})

app.get('/sandbox-lookup', async (c) => {
  const id = c.req.query('id')
  if (!id) {
    return c.json({ error: 'missing_id' }, 400)
  }
  try {
    const kubeClient = await kubeClientPromise
    const record = await getSandbox(id)
    if (!record) {
      return c.json({ error: 'not_found' }, 404)
    }
    const refreshed = await refreshSandboxPod(kubeClient, record)
    if (!refreshed.podIp) {
      return c.json({ error: 'pod_not_ready' }, 503)
    }
    return c.json({
      ok: true,
      podIp: refreshed.podIp,
    })
  } catch (error) {
    console.error('Failed to resolve sandbox lookup', error)
    return c.json({ error: 'sandbox_lookup_failed' }, 500)
  }
})

console.log(
  `Server running on http://localhost:${config.port} (sandboxImage=${config.sandbox.image})`,
)

Deno.serve({ port: config.port }, app.fetch)
