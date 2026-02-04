function readEnvTrimmed(key: string): string | undefined {
  const value = Deno.env.get(key)
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

async function run(cmd: string, args: string[]): Promise<void> {
  const child = new Deno.Command(cmd, {
    args,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  if (!status.success) {
    throw new Error(`${cmd} ${args.join(' ')} failed (code=${status.code})`)
  }
}

async function main() {
  const root = readEnvTrimmed('WUHU_CLI_INSTALL_ROOT') ??
    readEnvTrimmed('DENO_INSTALL') ?? '/usr/local'
  const name = readEnvTrimmed('WUHU_CLI_NAME') ?? 'wuhu'
  const entry = readEnvTrimmed('WUHU_CLI_ENTRY') ??
    'packages/sandbox-cli/main.ts'
  const configPath = readEnvTrimmed('WUHU_CLI_DENO_CONFIG') ??
    new URL('../deno.json', import.meta.url).pathname

  await run('deno', [
    'install',
    '--global',
    '--config',
    configPath,
    '-A',
    '--quiet',
    '--force',
    '--root',
    root,
    '--name',
    name,
    entry,
  ])

  console.log(`Installed ${name} to ${root.replace(/\/+$/, '')}/bin/${name}`)
}

if (import.meta.main) {
  await main()
}
