import { and, desc, eq, ne } from 'drizzle-orm'
import { createId, sandboxes } from '@wuhu/drizzle'
import { db } from './db.ts'
import type { SandboxConfig } from './config.ts'
import type { KubeClient } from './k8s.ts'
import { createSandboxJob, deleteSandboxJob, findSandboxPod } from './k8s.ts'

export type SandboxRecord = typeof sandboxes.$inferSelect

export interface SandboxCreateResult {
  record: SandboxRecord
}

function mapPodPhase(phase?: string): SandboxRecord['status'] | null {
  if (!phase) return null
  if (phase === 'Running') return 'running'
  if (phase === 'Failed') return 'failed'
  if (phase === 'Succeeded') return 'terminated'
  if (phase === 'Pending') return 'pending'
  return null
}

export async function createSandbox(
  client: KubeClient,
  sandboxConfig: SandboxConfig,
  input: { name?: string | null; repoFullName?: string | null },
): Promise<SandboxCreateResult> {
  const id = createId()
  const jobName = `sandbox-${id}`
  const namespace = sandboxConfig.namespace

  const [record] = await db.insert(sandboxes).values({
    id,
    name: input.name ?? null,
    repoFullName: input.repoFullName ?? null,
    status: 'pending',
    jobName,
    namespace,
    daemonPort: sandboxConfig.daemonPort,
    previewPort: sandboxConfig.previewPort,
  }).returning()

  try {
    await createSandboxJob(client, {
      id,
      jobName,
      namespace,
      image: sandboxConfig.image,
      daemonPort: sandboxConfig.daemonPort,
      previewPort: sandboxConfig.previewPort,
    })
  } catch (error) {
    await db.update(sandboxes)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.id, id))
    throw error
  }

  return { record }
}

export async function listSandboxes(options?: {
  includeTerminated?: boolean
}): Promise<SandboxRecord[]> {
  const includeTerminated = options?.includeTerminated ?? false
  if (!includeTerminated) {
    return await db
      .select()
      .from(sandboxes)
      .where(ne(sandboxes.status, 'terminated'))
      .orderBy(desc(sandboxes.createdAt))
  }
  return await db
    .select()
    .from(sandboxes)
    .orderBy(desc(sandboxes.createdAt))
}

export async function getSandbox(
  id: string,
): Promise<SandboxRecord | undefined> {
  const [record] = await db.select().from(sandboxes).where(eq(sandboxes.id, id))
  return record
}

export async function refreshSandboxPod(
  client: KubeClient,
  record: SandboxRecord,
): Promise<SandboxRecord> {
  if (record.status === 'terminated' || record.status === 'failed') {
    return record
  }
  const pod = await findSandboxPod(
    client,
    record.namespace,
    record.id,
  )
  if (!pod) return record
  const nextStatus = mapPodPhase(pod.phase) ?? record.status
  const [updated] = await db.update(sandboxes)
    .set({
      podName: pod.name ?? record.podName,
      podIp: pod.ip ?? record.podIp,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.id, record.id))
    .returning()
  return updated ?? record
}

export async function refreshSandboxes(
  client: KubeClient,
  records: SandboxRecord[],
): Promise<SandboxRecord[]> {
  const refreshed: SandboxRecord[] = []
  for (const record of records) {
    if (!record.podIp || record.status === 'pending') {
      refreshed.push(await refreshSandboxPod(client, record))
    } else {
      refreshed.push(record)
    }
  }
  return refreshed
}

export async function terminateSandbox(
  client: KubeClient,
  record: SandboxRecord,
): Promise<SandboxRecord> {
  await db.update(sandboxes)
    .set({ status: 'terminating', updatedAt: new Date() })
    .where(eq(sandboxes.id, record.id))

  if (record.jobName) {
    await deleteSandboxJob(client, record.namespace, record.jobName)
  }

  const [updated] = await db.update(sandboxes)
    .set({
      status: 'terminated',
      terminatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.id, record.id))
    .returning()
  return updated ?? record
}

export async function setSandboxTerminated(
  id: string,
): Promise<SandboxRecord | undefined> {
  const [updated] = await db.update(sandboxes)
    .set({
      status: 'terminated',
      terminatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(sandboxes.id, id), ne(sandboxes.status, 'terminated')))
    .returning()
  return updated
}
