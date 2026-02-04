import { getGitBranch, gitOutput, runGit } from './git.ts'
import type {
  SandboxDaemonCheckpointCommitEvent,
  SandboxDaemonEvent,
  SandboxDaemonGitCheckpointConfig,
} from './types.ts'
import type { WorkspaceState } from './workspace.ts'

function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    const value = vars[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

async function ensureCommitIdentity(cwd: string): Promise<void> {
  try {
    const email = (await runGit(['config', '--get', 'user.email'], cwd)).stdout
      .trim()
    const name = (await runGit(['config', '--get', 'user.name'], cwd)).stdout
      .trim()
    if (email && name) return
  } catch {
    // ignore
  }
  await runGit(['config', 'user.email', 'sandbox-daemon@local'], cwd)
  await runGit(['config', 'user.name', 'sandbox-daemon'], cwd)
}

async function hasStagedChanges(cwd: string): Promise<boolean> {
  const out = await gitOutput(['diff', '--cached', '--quiet'], cwd)
  // git diff --quiet returns exit code 1 when there are differences
  return out.code === 1
}

export class GitCheckpointer {
  #config: SandboxDaemonGitCheckpointConfig = { mode: 'off' }

  setConfig(config?: SandboxDaemonGitCheckpointConfig): void {
    this.#config = config ?? { mode: 'off' }
  }

  getConfig(): SandboxDaemonGitCheckpointConfig {
    return this.#config
  }

  async checkpoint(
    workspace: WorkspaceState,
    turn: number,
    onEvent: (event: SandboxDaemonEvent) => void,
  ): Promise<void> {
    const cfg = this.#config
    if (cfg.mode === 'off') return

    for (const [repoId, repo] of workspace.repos) {
      if (cfg.mode === 'mock') {
        const event: SandboxDaemonCheckpointCommitEvent = {
          source: 'daemon',
          type: 'checkpoint_commit',
          timestamp: Date.now(),
          repoId,
          branch: cfg.branchName ?? 'mock',
          commitSha: '0'.repeat(40),
          turn,
          pushed: false,
        }
        onEvent(event)
        continue
      }

      const desiredBranch = cfg.branchName
      if (desiredBranch) {
        await runGit(['checkout', '-B', desiredBranch], repo.absPath)
      }

      await runGit(['add', '-A'], repo.absPath)
      const changed = await hasStagedChanges(repo.absPath)
      if (!changed) {
        continue
      }

      const branch = desiredBranch ?? await getGitBranch(repo.absPath) ??
        'unknown'
      const template = cfg.commitMessageTemplate ?? 'checkpoint turn {turn}'
      const message = renderTemplate(template, { turn, repoId })

      try {
        await runGit(['commit', '-m', message], repo.absPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('author identity unknown')) {
          await ensureCommitIdentity(repo.absPath)
          await runGit(['commit', '-m', message], repo.absPath)
        } else {
          throw err
        }
      }

      const commitSha = (await runGit(['rev-parse', 'HEAD'], repo.absPath))
        .stdout.trim()

      let pushed = false
      if (cfg.push) {
        const remote = cfg.remote ?? 'origin'
        try {
          await runGit(['push', remote, branch], repo.absPath)
          pushed = true
        } catch {
          pushed = false
        }
      }

      const event: SandboxDaemonCheckpointCommitEvent = {
        source: 'daemon',
        type: 'checkpoint_commit',
        timestamp: Date.now(),
        repoId,
        branch,
        commitSha,
        turn,
        pushed,
      }
      onEvent(event)
    }
  }
}
