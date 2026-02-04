#!/usr/bin/env -S deno run -A
/**
 * Programmatic migration generation using drizzle-kit/api
 * Pure Deno - no nodeModulesDir needed
 */
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from './schema.ts'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url).pathname
const META_DIR = `${MIGRATIONS_DIR}meta/`

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

// Load journal
async function loadJournal(): Promise<Journal> {
  try {
    const text = await Deno.readTextFile(`${META_DIR}_journal.json`)
    return JSON.parse(text)
  } catch {
    return { version: '7', dialect: 'postgresql', entries: [] }
  }
}

// Load latest snapshot
async function loadLatestSnapshot(): Promise<Record<string, unknown>> {
  const journal = await loadJournal()
  if (journal.entries.length === 0) {
    return generateDrizzleJson({})
  }
  const lastIdx = journal.entries[journal.entries.length - 1].idx
  const text = await Deno.readTextFile(
    `${META_DIR}${String(lastIdx).padStart(4, '0')}_snapshot.json`,
  )
  return JSON.parse(text)
}

// Generate random tag (drizzle-kit style)
function generateTag(): string {
  const adjectives = [
    'swift',
    'bold',
    'calm',
    'dark',
    'easy',
    'fair',
    'good',
    'huge',
    'kind',
    'loud',
  ]
  const nouns = [
    'epoch',
    'dream',
    'cloud',
    'storm',
    'light',
    'river',
    'stone',
    'flame',
    'ocean',
    'frost',
  ]
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  return `${adj}_${noun}`
}

async function main() {
  // Ensure directories exist
  await Deno.mkdir(META_DIR, { recursive: true })

  // Load previous state
  const prevSnapshot = await loadLatestSnapshot()
  const journal = await loadJournal()

  // Generate current snapshot
  const currSnapshot = generateDrizzleJson(schema)

  // Generate migration
  const statements = await generateMigration(prevSnapshot, currSnapshot)

  if (statements.length === 0) {
    console.log('No changes detected.')
    return
  }

  // Prepare migration file
  const idx = journal.entries.length
  const tag = `${String(idx).padStart(4, '0')}_${generateTag()}`
  const timestamp = Date.now()

  // Write SQL migration
  const sql = statements.join('\n--> statement-breakpoint\n')
  await Deno.writeTextFile(`${MIGRATIONS_DIR}${tag}.sql`, sql)
  console.log(`Created: migrations/${tag}.sql`)

  // Write snapshot
  const snapshotWithMeta = {
    ...currSnapshot,
    id: crypto.randomUUID(),
    prevId: (prevSnapshot as { id?: string }).id ??
      '00000000-0000-0000-0000-000000000000',
  }
  await Deno.writeTextFile(
    `${META_DIR}${String(idx).padStart(4, '0')}_snapshot.json`,
    JSON.stringify(snapshotWithMeta, null, 2),
  )

  // Update journal
  journal.entries.push({
    idx,
    version: '7',
    when: timestamp,
    tag,
    breakpoints: true,
  })
  await Deno.writeTextFile(
    `${META_DIR}_journal.json`,
    JSON.stringify(journal, null, 2),
  )

  console.log('Migration generated successfully!')
  console.log('\nSQL:')
  console.log(sql)
}

main()
