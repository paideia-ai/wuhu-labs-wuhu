import { exists } from '@std/fs'
import { fromFileUrl, join, resolve } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'
import type {
  ResolveResult,
  ResolverPackageConfig,
  ResolverWorkspaceConfig,
} from './core.ts'
import { resolve as resolveMain } from './core.ts'

export class Resolver {
  #config?: ResolverWorkspaceConfig
  #loadingConfig?: Promise<ResolverWorkspaceConfig>

  async #loadConfig(): Promise<ResolverWorkspaceConfig> {
    if (this.#config) {
      return this.#config
    }

    if (this.#loadingConfig) {
      return await this.#loadingConfig
    }

    const promise = loadWorkspaceConfig()
    this.#loadingConfig = promise
    try {
      const config = await promise
      this.#config = config
      return config
    } finally {
      this.#loadingConfig = undefined
    }
  }

  async resolve(
    specifier: string,
    importerPath: string,
  ): Promise<ResolveResult> {
    const config = await this.#loadConfig()
    return await resolveMain(config, specifier, importerPath)
  }
}

export async function loadDenoJson(directoryPath: string) {
  const denoJsonPath = join(directoryPath, 'deno.json')
  const denoJsoncPath = join(directoryPath, 'deno.jsonc')

  if (await exists(denoJsonPath)) {
    const denoJson = await Deno.readTextFile(denoJsonPath)
    return JSON.parse(denoJson)
  }

  if (await exists(denoJsoncPath)) {
    const denoJsonc = await Deno.readTextFile(denoJsoncPath)
    return parseJsonc(denoJsonc)
  }

  return null
}

async function loadWorkspaceConfig(): Promise<ResolverWorkspaceConfig> {
  const workspaceRoot = resolve(fromFileUrl(import.meta.url), '../../../../')
  const workspaceDenoConfig = await loadDenoJson(workspaceRoot)

  const packages: ResolverPackageConfig[] = []
  for (const packagePath of (workspaceDenoConfig.workspace || []) as string[]) {
    const packageDenoConfig = await loadDenoJson(
      join(workspaceRoot, packagePath),
    )
    if (!packageDenoConfig) {
      continue
    }

    const imports = (packageDenoConfig.imports || {}) as Record<string, string>
    let exports: Record<string, string>
    if (typeof packageDenoConfig.exports === 'string') {
      exports = {
        '.': packageDenoConfig.exports,
      }
    } else {
      exports = packageDenoConfig.exports || {}
    }

    packages.push({
      name: packageDenoConfig.name as string,
      path: packagePath,
      imports: imports,
      exports: exports,
    })
  }

  const jsrVersions: Record<string, string> = {}
  try {
    const denoLockJson = await Deno.readTextFile(
      join(workspaceRoot, 'deno.lock'),
    )
    const denoLockConfig = JSON.parse(denoLockJson)
    for (
      const [specifier, version] of Object.entries(
        (denoLockConfig.specifiers || {}) as Record<string, string>,
      )
    ) {
      if (!specifier.startsWith('jsr:')) {
        continue
      }
      jsrVersions[specifier.slice(4)] = version
    }
  } catch {
    // deno.lock might not exist yet
  }

  return {
    rootPath: workspaceRoot,
    packages: packages,
    jsrVersions: jsrVersions,
  }
}
