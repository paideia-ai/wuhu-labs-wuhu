import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from '@std/path'

import { runGit } from './git.ts'

import type {
  SandboxDaemonEvent,
  SandboxDaemonRepoClonedEvent,
  SandboxDaemonRepoCloneErrorEvent,
  SandboxDaemonRepoConfig,
} from './types.ts'

export interface WorkspaceRepoState {
  id: string
  absPath: string
}

export interface WorkspaceState {
  root: string
  repos: Map<string, WorkspaceRepoState>
}

function sourceToGitUrl(source: string): string {
  if (source.startsWith('github:')) {
    const slug = source.slice('github:'.length)
    const cleaned = slug.endsWith('.git') ? slug : `${slug}.git`
    return `https://github.com/${cleaned}`
  }
  return source
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch {
    return false
  }
}

async function isEmptyDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path)
    if (!stat.isDirectory) return false
    for await (const _entry of Deno.readDir(path)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function isGitRepo(absPath: string): Promise<boolean> {
  if (!await pathExists(absPath)) return false
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], absPath)
    return true
  } catch {
    return false
  }
}

function resolveWithinRoot(root: string, repoPath: string): string {
  const resolvedRoot = normalize(resolve(root))
  const resolvedPath = isAbsolute(repoPath)
    ? normalize(resolve(repoPath))
    : normalize(resolve(join(resolvedRoot, repoPath)))
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel.startsWith('..') || rel.startsWith('../') || rel === '..') {
    throw new Error('repo_path_outside_workspace_root')
  }
  return resolvedPath
}

export async function ensureRepo(
  workspaceRoot: string,
  repo: SandboxDaemonRepoConfig,
  onEvent?: (event: SandboxDaemonEvent) => void,
): Promise<WorkspaceRepoState> {
  const absPath = resolveWithinRoot(workspaceRoot, repo.path)
  await Deno.mkdir(dirname(absPath), { recursive: true })

  const alreadyRepo = await isGitRepo(absPath)
  if (!alreadyRepo) {
    try {
      const url = sourceToGitUrl(repo.source)
      const args = ['clone']
      if (repo.branch) {
        args.push('--branch', repo.branch)
      }
      const exists = await pathExists(absPath)
      if (!exists) {
        args.push(url, absPath)
        await runGit(args, workspaceRoot)
      } else if (await isEmptyDir(absPath)) {
        args.push(url, '.')
        await runGit(args, absPath)
      } else {
        throw new Error('repo_path_exists_and_is_not_a_git_repo')
      }
      const event: SandboxDaemonRepoClonedEvent = {
        source: 'daemon',
        type: 'repo_cloned',
        repoId: repo.id,
        path: repo.path,
      }
      onEvent?.(event)
    } catch (err) {
      const event: SandboxDaemonRepoCloneErrorEvent = {
        source: 'daemon',
        type: 'repo_clone_error',
        repoId: repo.id,
        error: err instanceof Error ? err.message : String(err),
      }
      onEvent?.(event)
      throw err
    }
  } else if (repo.branch) {
    try {
      await runGit(['checkout', repo.branch], absPath)
    } catch {
      // Ignore checkout errors; branch may not exist locally.
    }
  }

  return { id: repo.id, absPath }
}

export async function getCurrentBranch(
  absPath: string,
): Promise<string | undefined> {
  try {
    const out = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], absPath)
    const branch = out.stdout.trim()
    if (!branch || branch === 'HEAD') return undefined
    return branch
  } catch {
    return undefined
  }
}
