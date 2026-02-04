/**
 * A dummy shared package to test cross-workspace dependencies
 */

export function greet(name: string): string {
  return `Hello, ${name}!`
}

export const VERSION = '0.0.1'

export interface SharedConfig {
  debug: boolean
  maxRetries: number
}

export const defaultConfig: SharedConfig = {
  debug: false,
  maxRetries: 3,
}
