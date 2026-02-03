import { isAbsolute, join, relative } from '@std/path'
import type { Plugin } from 'vite'
import { Resolver } from './resolver.ts'

export function resolveDenoImports(): Plugin {
  const resolver = new Resolver()
  let isDev = false

  return {
    name: 'resolve-deno-imports',
    configureServer() {
      isDev = true
    },
    async resolveId(source, importer, options) {
      const ssr = options.ssr || false

      if (
        source.startsWith('/') || source.startsWith('\0') ||
        source.startsWith('virtual:')
      ) {
        return null
      }
      if (importer?.includes('node_modules')) {
        return null
      }

      let absoluteImporterPath = importer || ''
      let inLocalPackage = false

      if (!importer) {
        absoluteImporterPath = Deno.cwd()
        inLocalPackage = true
      } else if (!isAbsolute(importer)) {
        absoluteImporterPath = join(Deno.cwd(), importer)
        inLocalPackage = true
      }

      try {
        const result = await resolver.resolve(source, absoluteImporterPath)

        switch (result.type) {
          case 'npm':
            return null
          case 'local':
            if (inLocalPackage) {
              return relative(Deno.cwd(), result.path)
            }
            return {
              id: result.path,
              external: false,
            }
          case 'peer': {
            const isAsset = result.path.endsWith('.css')
            return {
              id: result.path,
              external: !isDev && ssr && !isAsset,
            }
          }
          case 'jsr': {
            if (isDev || !ssr) {
              return {
                id: result.path,
                external: false,
              }
            }
            return {
              id: source,
              external: true,
            }
          }
        }
      } catch (error) {
        console.error(
          `An error occurred while resolving:\n  source: ${source}\n  importer: ${importer}\n  ${error}`,
          error,
        )
        return null
      }
    },
  }
}
