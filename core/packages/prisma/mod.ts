import { assert } from '@std/assert'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from './generated/client.ts'
export { Prisma, type PrismaClient } from './generated/client.ts'

export interface CreatePrismaClientOptions {
  connectionString?: string
}

export function createPrismaClient(options?: CreatePrismaClientOptions) {
  const connectionString = options?.connectionString ??
    Deno.env.get('DATABASE_URL')
  assert(connectionString, 'DATABASE_URL is required!')

  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  const client = new PrismaClient({ adapter })

  return client
}
