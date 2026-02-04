import { assertEquals } from '@std/assert'
import { configureWuhuCli } from '../src/wuhu-cli.ts'

Deno.test('init configuration writes core api config', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'wuhu-cli-config-' })
  const prev = {
    sandboxId: Deno.env.get('WUHU_SANDBOX_ID'),
    coreApiUrl: Deno.env.get('WUHU_CORE_API_URL'),
    configPath: Deno.env.get('WUHU_CLI_CONFIG_PATH'),
  }

  try {
    const result = await configureWuhuCli(dir, {
      sandboxId: 'sb_test',
      coreApiUrl: 'http://core.test/',
    })
    if (!result) throw new Error('expected config')
    assertEquals(result.config.coreApiUrl, 'http://core.test')

    const raw = await Deno.readTextFile(result.configPath)
    const parsed = JSON.parse(raw) as { sandboxId: string; coreApiUrl: string }
    assertEquals(parsed.sandboxId, 'sb_test')
    assertEquals(parsed.coreApiUrl, 'http://core.test')
  } finally {
    if (prev.sandboxId === undefined) Deno.env.delete('WUHU_SANDBOX_ID')
    else Deno.env.set('WUHU_SANDBOX_ID', prev.sandboxId)
    if (prev.coreApiUrl === undefined) Deno.env.delete('WUHU_CORE_API_URL')
    else Deno.env.set('WUHU_CORE_API_URL', prev.coreApiUrl)
    if (prev.configPath === undefined) Deno.env.delete('WUHU_CLI_CONFIG_PATH')
    else Deno.env.set('WUHU_CLI_CONFIG_PATH', prev.configPath)
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
})
