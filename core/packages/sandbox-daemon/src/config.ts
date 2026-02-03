import {
  readEnvBool,
  readEnvNumber,
  readEnvString,
  readEnvTrimmed,
} from './env.ts'

import type { SandboxDaemonAgentMode } from './types.ts'

export interface SandboxDaemonJwtConfig {
  enabled: boolean
  secret?: string
  issuer?: string
}

export interface SandboxDaemonPiConfig {
  command?: string
  args?: string[]
  cwd?: string
}

export interface SandboxDaemonConfig {
  host: string
  port: number
  agentMode: SandboxDaemonAgentMode
  jwt: SandboxDaemonJwtConfig
  pi: SandboxDaemonPiConfig
  workspaceRoot?: string
}

export function parseArgsEnv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed
      }
    } catch {
      // Fall through to whitespace split.
    }
  }
  return trimmed.split(/\s+/g).filter(Boolean)
}

export function loadSandboxDaemonConfig(): SandboxDaemonConfig {
  const host = readEnvString('SANDBOX_DAEMON_HOST', '127.0.0.1')
  const port = readEnvNumber('SANDBOX_DAEMON_PORT', 8787)
  const agentMode = readEnvString(
    'SANDBOX_DAEMON_AGENT_MODE',
    'pi-rpc',
  ) as SandboxDaemonAgentMode

  const jwtSecret = readEnvTrimmed('SANDBOX_DAEMON_JWT_SECRET')
  const jwtIssuer = readEnvTrimmed('SANDBOX_DAEMON_JWT_ISSUER')
  const jwtEnabled = readEnvBool(
    'SANDBOX_DAEMON_JWT_ENABLED',
    Boolean(jwtSecret),
  )
  if (jwtEnabled && !jwtSecret) {
    throw new Error(
      'SANDBOX_DAEMON_JWT_ENABLED=true requires SANDBOX_DAEMON_JWT_SECRET',
    )
  }

  const piCommand = readEnvTrimmed('SANDBOX_DAEMON_PI_COMMAND')
  const piArgs = parseArgsEnv(readEnvTrimmed('SANDBOX_DAEMON_PI_ARGS'))
  const piCwd = readEnvTrimmed('SANDBOX_DAEMON_PI_CWD')

  const workspaceRoot = readEnvTrimmed('SANDBOX_DAEMON_WORKSPACE_ROOT')

  return {
    host,
    port,
    agentMode,
    jwt: { enabled: jwtEnabled, secret: jwtSecret, issuer: jwtIssuer },
    pi: { command: piCommand, args: piArgs, cwd: piCwd },
    workspaceRoot,
  }
}
