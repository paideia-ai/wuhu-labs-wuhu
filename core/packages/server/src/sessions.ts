import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '@wuhu/drizzle'
import { messages, sandboxes, sessions } from '@wuhu/drizzle/schema'

export type SearchSessionsOptions = {
  limit?: number
  offset?: number
}

export type SearchSessionsResult = {
  sessions: Array<{
    id: string
    cursor: number
    createdAt: Date
    updatedAt: Date
    score: number
  }>
}

const ftsEligibleMessage = or(
  eq(messages.role, 'user'),
  and(
    eq(messages.role, 'assistant'),
    isNull(messages.toolName),
    isNull(messages.toolCallId),
  ),
)

export async function searchSessions(
  db: Database,
  query: string,
  options?: SearchSessionsOptions,
): Promise<SearchSessionsResult> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 0), 100)
  const offset = Math.max(options?.offset ?? 0, 0)

  const trimmed = query.trim()
  if (!trimmed) return { sessions: [] }

  const tsQuery = sql`websearch_to_tsquery('english', ${trimmed})`
  const tsv = sql`to_tsvector('english', ${messages.content})`
  const matches = sql`${tsv} @@ ${tsQuery}`
  const score = sql<number>`sum(ts_rank_cd(${tsv}, ${tsQuery}))`
    .mapWith(Number)
    .as('score')

  const ranked = db
    .select({
      sessionId: messages.sessionId,
      score,
    })
    .from(messages)
    .where(and(ftsEligibleMessage, matches))
    .groupBy(messages.sessionId)
    .as('ranked')

  const rows = await db
    .select({
      id: sessions.id,
      cursor: sessions.cursor,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      score: ranked.score,
    })
    .from(ranked)
    .innerJoin(sessions, eq(sessions.id, ranked.sessionId))
    .orderBy(desc(ranked.score), desc(sessions.updatedAt))
    .limit(limit)
    .offset(offset)

  return {
    sessions: rows.map((row) => ({
      id: row.id,
      cursor: row.cursor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      score: row.score,
    })),
  }
}

export type GetSessionLogResult = {
  session: {
    id: string
    cursor: number
    createdAt: Date
    updatedAt: Date
  }
  sandbox: {
    id: string
    name: string | null
    repoFullName: string | null
    status: string
    createdAt: Date
    updatedAt: Date
    terminatedAt: Date | null
  }
  messages: Array<{
    cursor: number
    role: string
    content: string
    toolName: string | null
    toolCallId: string | null
    turnIndex: number
    createdAt: Date
  }>
}

export async function getSessionLog(
  db: Database,
  sessionId: string,
): Promise<GetSessionLogResult | null> {
  const sessionRows = await db
    .select({
      id: sessions.id,
      cursor: sessions.cursor,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      sandboxId: sandboxes.id,
      sandboxName: sandboxes.name,
      sandboxRepoFullName: sandboxes.repoFullName,
      sandboxStatus: sandboxes.status,
      sandboxCreatedAt: sandboxes.createdAt,
      sandboxUpdatedAt: sandboxes.updatedAt,
      sandboxTerminatedAt: sandboxes.terminatedAt,
    })
    .from(sessions)
    .innerJoin(sandboxes, eq(sandboxes.id, sessions.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) return null

  const messageRows = await db
    .select({
      cursor: messages.cursor,
      role: messages.role,
      content: messages.content,
      toolName: messages.toolName,
      toolCallId: messages.toolCallId,
      turnIndex: messages.turnIndex,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.cursor))

  return {
    session: {
      id: session.id,
      cursor: session.cursor,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    sandbox: {
      id: session.sandboxId,
      name: session.sandboxName,
      repoFullName: session.sandboxRepoFullName,
      status: session.sandboxStatus,
      createdAt: session.sandboxCreatedAt,
      updatedAt: session.sandboxUpdatedAt,
      terminatedAt: session.sandboxTerminatedAt,
    },
    messages: messageRows,
  }
}
