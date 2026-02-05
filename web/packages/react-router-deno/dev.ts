import { createServer, version } from 'vite'
import { reactRouterDev } from './config.ts'
import { createRequire } from 'node:module'

console.log('vite version:', version)

// Workaround for a Deno+Vite flake:
// Vite's bundled-config loader writes a temporary
// `vite.config.*.timestamp-*.mjs` file, imports it, then unlinks it. Under
// Deno's Node-compat `fs.watch`, Vite can race and attempt to watch the temp
// file after it's been removed, which crashes the dev server with ENOENT.
//
// Keep these temp files around for the duration of the process to avoid the
// race. Old temp files are cleaned up on startup.
const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')

for await (const entry of Deno.readDir(Deno.cwd())) {
  if (!entry.isFile) continue
  if (
    entry.name.startsWith('vite.config.') &&
    entry.name.includes('.timestamp-') &&
    entry.name.endsWith('.mjs')
  ) {
    try {
      await Deno.remove(entry.name)
    } catch {
      // ignore
    }
  }
}

const originalUnlink = fs.unlink.bind(fs)
const patchedUnlink = ((path, callback) => {
  const filename = typeof path === 'string'
    ? path.split(/[\\/]/).pop() ?? path
    : null

  if (
    filename &&
    filename.startsWith('vite.config.') &&
    filename.includes('.timestamp-') &&
    filename.endsWith('.mjs')
  ) {
    callback?.(null)
    return
  }

  // @ts-ignore - Node typings allow more path types than our check covers.
  return originalUnlink(path, callback)
}) as typeof fs.unlink // Preserve `util.promisify` support on the patched function.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
;(patchedUnlink as any).__promisify__ = (path: unknown) =>
  new Promise<void>((resolve, reject) => {
    // @ts-ignore - Node typings allow more path types than our check covers.
    patchedUnlink(path, (error) => error ? reject(error) : resolve())
  })

fs.unlink = patchedUnlink

if (fs.promises?.unlink) {
  const originalPromisesUnlink = fs.promises.unlink.bind(fs.promises)
  fs.promises.unlink = async (path) => {
    const filename = typeof path === 'string'
      ? path.split(/[\\/]/).pop() ?? path
      : null

    if (
      filename &&
      filename.startsWith('vite.config.') &&
      filename.includes('.timestamp-') &&
      filename.endsWith('.mjs')
    ) {
      return
    }

    return await originalPromisesUnlink(path)
  }
}

const config = reactRouterDev()
const server = await createServer({
  ...config,
  configFile: './vite.config.ts',
  configLoader: 'native',
})

await server.listen()
server.printUrls()
