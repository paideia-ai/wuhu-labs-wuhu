import { assertEquals } from '@std/assert'
import { runWuhuCli } from '../src/cli.ts'

function createDeps(overrides?: Partial<Parameters<typeof runWuhuCli>[1]>) {
  const stdout: string[] = []
  const stderr: string[] = []
  const calls: Array<{ url: string; init: RequestInit }> = []

  const deps = {
    env: {},
    isTty: false,
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url
      calls.push({ url, init: init ?? {} })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    writeStdout: (text: string) => void stdout.push(text),
    writeStderr: (text: string) => void stderr.push(text),
    ...overrides,
  }

  return { deps, stdout, stderr, calls }
}

Deno.test('query posts to sessions search', async () => {
  const { deps, calls } = createDeps({
    env: { WUHU_CORE_API_URL: 'http://core.test/' },
  })

  const res = await runWuhuCli(
    ['past-sessions', 'query', 'banana', '--limit', '5', '--offset', '2'],
    deps,
  )
  assertEquals(res.code, 0)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, 'http://core.test/sessions/search')
  assertEquals(calls[0].init.method, 'POST')
  const body = JSON.parse(String(calls[0].init.body))
  assertEquals(body.query, 'banana')
  assertEquals(body.limit, 5)
  assertEquals(body.offset, 2)
})

Deno.test('get fetches session by id', async () => {
  const { deps, calls } = createDeps({
    env: { WUHU_CORE_API_URL: 'http://core.test' },
  })

  const res = await runWuhuCli(['past-sessions', 'get', 'sb_123'], deps)
  assertEquals(res.code, 0)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, 'http://core.test/sessions/sb_123')
  assertEquals(calls[0].init.method, 'GET')
})

Deno.test('unknown command returns non-zero', async () => {
  const { deps, stderr } = createDeps()
  const res = await runWuhuCli(['nope'], deps)
  assertEquals(res.code, 1)
  assertEquals(stderr.join('').includes('unknown command'), true)
})
