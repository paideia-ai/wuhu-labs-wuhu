import { coreFunction, heavyComputation } from "@test/core"

export function apiFunction(): string {
  return `api calls ${coreFunction()}`
}

export function apiHeavy(): number {
  return heavyComputation() * 2
}
