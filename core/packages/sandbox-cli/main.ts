import { runWuhuCli } from './src/cli.ts'

if (import.meta.main) {
  const result = await runWuhuCli(Deno.args, {
    env: Deno.env.toObject(),
    fetchFn: fetch,
    isTty: Deno.stdout.isTerminal(),
    writeStdout: async (text) => {
      await Deno.stdout.write(new TextEncoder().encode(text))
    },
    writeStderr: async (text) => {
      await Deno.stderr.write(new TextEncoder().encode(text))
    },
  })
  Deno.exit(result.code)
}
