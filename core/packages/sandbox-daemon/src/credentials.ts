import type { SandboxDaemonCredentialsPayload } from './types.ts'

export interface CredentialsSnapshot {
  payload?: SandboxDaemonCredentialsPayload
  env: Record<string, string>
  revision: number
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export function credentialsToEnv(
  payload: SandboxDaemonCredentialsPayload,
): Record<string, string> {
  const env: Record<string, string> = {}

  const openaiApiKey = trimOrUndefined(payload.llm?.openaiApiKey)
  if (openaiApiKey) env.OPENAI_API_KEY = openaiApiKey

  const anthropicApiKey = trimOrUndefined(payload.llm?.anthropicApiKey)
  if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey

  const githubToken = trimOrUndefined(payload.github?.token)
  if (githubToken) env.GITHUB_TOKEN = githubToken

  const githubUsername = trimOrUndefined(payload.github?.username)
  if (githubUsername) env.GITHUB_USERNAME = githubUsername

  const githubEmail = trimOrUndefined(payload.github?.email)
  if (githubEmail) env.GITHUB_EMAIL = githubEmail

  const extraEnv = payload.extra?.env
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      const cleaned = trimOrUndefined(value)
      if (cleaned) env[key] = cleaned
    }
  }

  return env
}

export function applyCredentialsToEnv(
  payload: SandboxDaemonCredentialsPayload,
): Record<string, string> {
  const env = credentialsToEnv(payload)
  for (const [key, value] of Object.entries(env)) {
    Deno.env.set(key, value)
  }
  return env
}

export class InMemoryCredentialsStore {
  #payload?: SandboxDaemonCredentialsPayload
  #env: Record<string, string> = {}
  #revision = 0

  set(payload: SandboxDaemonCredentialsPayload): CredentialsSnapshot {
    this.#payload = payload
    this.#env = credentialsToEnv(payload)
    this.#revision++
    return this.get()
  }

  get(): CredentialsSnapshot {
    return {
      payload: this.#payload,
      env: { ...this.#env },
      revision: this.#revision,
    }
  }
}
