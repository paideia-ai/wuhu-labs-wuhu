import { integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { createId } from './utils.ts'

export const sandboxStatus = pgEnum('sandbox_status', [
  'pending',
  'running',
  'terminating',
  'terminated',
  'failed',
])

export const sandboxes = pgTable('sandboxes', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: text('name'),
  repoFullName: text('repo_full_name'),
  status: sandboxStatus('status').notNull().default('pending'),
  jobName: text('job_name').notNull().unique(),
  namespace: text('namespace').notNull(),
  podName: text('pod_name'),
  podIp: text('pod_ip'),
  daemonPort: integer('daemon_port').notNull().default(8787),
  previewPort: integer('preview_port').notNull().default(8066),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() =>
    new Date()
  ),
  terminatedAt: timestamp('terminated_at'),
})
