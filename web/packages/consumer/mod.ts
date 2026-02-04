/**
 * A consumer package that depends on @wuhu/shared
 */

import {
  type CreateDatabaseOptions,
  defaultConfig,
  greet,
  type SharedConfig,
  VERSION,
} from '@wuhu/shared'

export function sayHello(name: string): string {
  console.log(`Using shared package version: ${VERSION}`)
  return greet(name)
}

export function getConfig(): SharedConfig {
  return { ...defaultConfig, debug: true }
}

// Use the re-exported type from @wuhu/drizzle via @wuhu/shared
export function printDbOptions(opts: CreateDatabaseOptions): void {
  console.log('DB options:', opts)
}
