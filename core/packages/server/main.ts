import { Hono } from '@hono/hono'
import { cors } from '@hono/hono/cors'
import { loadConfig } from './src/config.ts'
import { createKubeClient } from './src/k8s.ts'
import type { SandboxRecord } from './src/sandbox-service.ts'
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

app.use('*', cors())

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
  let body: { name?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  try {
    const kubeClient = await kubeClientPromise
    const { record } = await createSandbox(kubeClient, config.sandbox, {
      name: body.name ?? null,
    })
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
