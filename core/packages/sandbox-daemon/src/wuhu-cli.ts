import { dirname, join } from '@std/path'

export type WuhuCliConfig = {
  sandboxId: string
  coreApiUrl: string
  updatedAt: string
}

export function defaultWuhuCliConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.wuhu', 'core.json')
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export async function configureWuhuCli(
  workspaceRoot: string,
  input: { sandboxId: string; coreApiUrl: string },
): Promise<{ configPath: string; config: WuhuCliConfig } | null> {
  const sandboxId = input.sandboxId.trim()
  const coreApiUrl = normalizeBaseUrl(input.coreApiUrl)
  if (!sandboxId || !coreApiUrl) return null

  const config: WuhuCliConfig = {
    sandboxId,
    coreApiUrl,
    updatedAt: new Date().toISOString(),
  }

  const configPath = defaultWuhuCliConfigPath(workspaceRoot)

  try {
    Deno.env.set('WUHU_SANDBOX_ID', sandboxId)
    Deno.env.set('WUHU_CORE_API_URL', coreApiUrl)
    Deno.env.set('WUHU_CLI_CONFIG_PATH', configPath)
  } catch {
    // ignore env write failures (best-effort)
  }

  try {
    await Deno.mkdir(dirname(configPath), { recursive: true })
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + '\n')
  } catch {
    // ignore config write failures (best-effort)
  }

  return { configPath, config }
}
