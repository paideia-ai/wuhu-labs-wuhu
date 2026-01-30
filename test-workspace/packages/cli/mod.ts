import { apiFunction, apiHeavy } from "@test/api"

export function cliFunction(): string {
  return `cli calls ${apiFunction()}`
}

export function cliHeavy(): number {
  return apiHeavy() + 1
}
