import { assertEquals } from '@std/assert'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { Hono } from '@hono/hono'
import type { Database } from '@wuhu/drizzle'
import * as schema from '@wuhu/drizzle/schema'
import { messages, sandboxes, sessions } from '@wuhu/drizzle/schema'
import { persistSandboxState } from './state.ts'
import { registerSessionRoutes } from './sessions-routes.ts'
import { searchSessions } from './sessions.ts'

const migrationsFolder = new URL(
  '../../drizzle/migrations',
  import.meta.url,
).pathname

async function withTestDb(
  fn: (db: Database) => Promise<void>,
): Promise<void> {
  const connectionString = Deno.env.get('DATABASE_URL')
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run server DB tests')
  }

  const client = postgres(connectionString, { max: 1 })
  const db = drizzle(client, { schema }) as unknown as Database

  try {
    await migrate(db, { migrationsFolder })
    await fn(db)
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function seedSandbox(db: Database, sandboxId: string) {
  await db.insert(sandboxes).values({
    id: sandboxId,
    jobName: `job_${sandboxId}`,
    namespace: 'test',
  })
}

async function cleanupSandbox(db: Database, sandboxId: string) {
  await db.delete(messages).where(eq(messages.sessionId, sandboxId))
  await db.delete(sessions).where(eq(sessions.id, sandboxId))
  await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId))
}

Deno.test('FTS search excludes tool + tool-call messages', async () => {
  await withTestDb(async (db) => {
    const ids = Array.from(
      { length: 4 },
      () => `sb_${crypto.randomUUID().slice(0, 12)}`,
    )
    const [userMatch, toolOnly, assistantToolCall, assistantMatch] = ids

    try {
      for (const id of ids) await seedSandbox(db, id)

      await persistSandboxState(db, userMatch, {
        cursor: 2,
        messages: [
          {
            cursor: 1,
            role: 'user',
            content: 'please search banana',
            turnIndex: 1,
          },
          {
            cursor: 2,
            role: 'tool',
            content: 'banana from tool output',
            toolName: 'bash',
            toolCallId: 'call_1',
            turnIndex: 1,
          },
        ],
      })

      await persistSandboxState(db, toolOnly, {
        cursor: 1,
        messages: [
          {
            cursor: 1,
            role: 'tool',
            content: 'banana only appears in tool messages',
            toolName: 'bash',
            toolCallId: 'call_2',
            turnIndex: 1,
          },
        ],
      })

      await persistSandboxState(db, assistantToolCall, {
        cursor: 1,
        messages: [
          {
            cursor: 1,
            role: 'assistant',
            content: 'banana appears but is a tool call',
            toolName: 'bash',
            toolCallId: 'call_3',
            turnIndex: 1,
          },
        ],
      })

      await persistSandboxState(db, assistantMatch, {
        cursor: 1,
        messages: [
          {
            cursor: 1,
            role: 'assistant',
            content: 'banana appears in final assistant output',
            turnIndex: 1,
          },
        ],
      })

      const result = await searchSessions(db, 'banana', {
        limit: 50,
        offset: 0,
      })
      const sessionIds = result.sessions.map((row) => row.id).sort()
      assertEquals(sessionIds, [assistantMatch, userMatch].sort())
    } finally {
      for (const id of ids) await cleanupSandbox(db, id)
    }
  })
})

Deno.test('Sessions endpoints validate and format responses', async () => {
  await withTestDb(async (db) => {
    const id = `sb_${crypto.randomUUID().slice(0, 12)}`

    try {
      await seedSandbox(db, id)
      await persistSandboxState(db, id, {
        cursor: 2,
        messages: [
          {
            cursor: 2,
            role: 'assistant',
            content: 'second banana',
            turnIndex: 1,
          },
          { cursor: 1, role: 'user', content: 'first banana', turnIndex: 1 },
        ],
      })

      const app = new Hono()
      registerSessionRoutes(app, db)

      const bad = await app.request('http://core.test/sessions/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      assertEquals(bad.status, 400)

      const searchRes = await app.request('http://core.test/sessions/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'banana', limit: 1, offset: 0 }),
      })
      assertEquals(searchRes.status, 200)
      const searchBody = await searchRes.json() as { sessions: unknown[] }
      assertEquals(searchBody.sessions.length, 1)

      const sessionRes = await app.request(`http://core.test/sessions/${id}`)
      assertEquals(sessionRes.status, 200)
      const body = await sessionRes.json() as {
        session: { id: string }
        sandbox: Record<string, unknown>
        messages: Array<{ cursor: number }>
      }
      assertEquals(body.session.id, id)
      assertEquals(body.messages.map((m) => m.cursor), [1, 2])
      assertEquals('jobName' in body.sandbox, false)

      const missing = await app.request(
        `http://core.test/sessions/sb_${crypto.randomUUID().slice(0, 12)}`,
      )
      assertEquals(missing.status, 404)
    } finally {
      await cleanupSandbox(db, id)
    }
  })
})
