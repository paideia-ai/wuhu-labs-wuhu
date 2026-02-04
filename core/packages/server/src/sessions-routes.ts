import type { Context, Hono } from '@hono/hono'
import type { Database } from '@wuhu/drizzle'
import { getSessionLog, searchSessions } from './sessions.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNumberField(
  body: Record<string, unknown>,
  key: string,
): number | null {
  const value = body[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function badRequest(c: Context, error: string) {
  return c.json({ error }, 400)
}

export function registerSessionRoutes(app: Hono, db: Database) {
  app.post('/sessions/search', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'invalid_json')
    }

    if (!isRecord(body)) return badRequest(c, 'invalid_body')
    const query = typeof body.query === 'string' ? body.query : ''
    if (!query.trim()) return badRequest(c, 'query_required')

    const limitRaw = parseNumberField(body, 'limit')
    const offsetRaw = parseNumberField(body, 'offset')
    const limit = limitRaw !== null && Number.isFinite(limitRaw)
      ? Math.floor(limitRaw)
      : undefined
    const offset = offsetRaw !== null && Number.isFinite(offsetRaw)
      ? Math.floor(offsetRaw)
      : undefined

    try {
      const result = await searchSessions(db, query, { limit, offset })
      return c.json(result)
    } catch (error) {
      console.error('Failed to search sessions', error)
      return c.json({ error: 'sessions_search_failed' }, 500)
    }
  })

  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    if (!id) return badRequest(c, 'id_required')

    try {
      const result = await getSessionLog(db, id)
      if (!result) return c.json({ error: 'not_found' }, 404)
      return c.json(result)
    } catch (error) {
      console.error('Failed to fetch session log', error)
      return c.json({ error: 'session_fetch_failed' }, 500)
    }
  })
}
