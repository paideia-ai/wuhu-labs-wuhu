import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export type Database = PostgresJsDatabase<typeof schema>

export interface CreateDatabaseOptions {
  connectionString?: string
}

export function createDatabase(options?: CreateDatabaseOptions): Database {
  const connectionString = options?.connectionString ??
    Deno.env.get('DATABASE_URL')
  if (!connectionString) {
    throw new Error('DATABASE_URL is required!')
  }

  const client = postgres(connectionString)
  return drizzle(client, { schema })
}

export { schema }
export * from './schema.ts'
export * from './utils.ts'
