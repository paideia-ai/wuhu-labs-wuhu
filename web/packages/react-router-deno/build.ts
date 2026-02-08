import { createBuilder, version } from 'vite'
import { createRequire } from 'node:module'

console.log('vite version:', version)

// Same flake as `dev.ts`: keep Vite's bundled-config temp file around so the
// file watcher doesn't race with cleanup under Deno.
const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
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

const builder = await createBuilder({
  root: '.',
  configFile: './vite.config.ts',
  configLoader: 'native',
  mode: 'production',
})

await builder.buildApp()
