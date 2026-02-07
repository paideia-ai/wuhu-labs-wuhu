// Pool of markdown fragments used to build mock assistant messages and
// reasoning summaries. Each fragment is a self-contained piece of markdown.

export const assistantFragments: string[] = [
  `I'll help you with that. Let me start by reading the relevant files to understand the current structure.`,

  `Looking at the codebase, I can see the project uses a monorepo setup with separate packages for the frontend and backend. Let me examine the specific files you mentioned.`,

  `Based on my analysis, here's what I found:

- The configuration is defined in \`config.ts\`
- The main entry point imports from three sub-modules
- There are some unused imports that could be cleaned up`,

  `I've made the changes you requested. Here's a summary:

1. **Updated the handler** to accept the new parameter
2. **Added validation** for the input format
3. **Updated the tests** to cover the new behavior`,

  `Let me look at the test failures to understand what's going wrong.`,

  `The issue is in the \`processItems\` function. It's not handling the edge case where the input array is empty. Let me fix that.`,

  `I'll refactor this to use a more idiomatic pattern:

\`\`\`typescript
const results = items
  .filter(item => item.isActive)
  .map(item => transform(item))
\`\`\`

This is cleaner than the manual loop and handles the empty case correctly.`,

  `Done! The build passes and all 47 tests are green. Here's what changed:

- \`src/handlers/process.ts\` — fixed the empty array edge case
- \`src/handlers/process.test.ts\` — added regression test
- \`src/types.ts\` — exported the new \`ProcessResult\` type`,

  `Let me check if there are any other files that import from this module, since we changed the export signature.`,

  `I found a potential issue with the database migration. The \`ALTER TABLE\` statement needs to run before the seed script. Let me reorder the migration steps.`,

  `The API endpoint is returning a 422 because the request body doesn't match the expected schema. Looking at the Zod validator:

\`\`\`typescript
const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'viewer']),
})
\`\`\`

The \`role\` field is required but the frontend is sending it as optional.`,

  `All changes look good. I've verified that:

- The dev server starts without errors
- The production build completes successfully
- No type errors in the codebase`,
]

export const reasoningSummaryFragments: string[] = [
  `The user wants me to fix a bug in the authentication flow. I need to read the auth middleware first, then trace the token validation logic.`,

  `I should check the test file to understand the expected behavior before making changes. The failing test name suggests an edge case with expired tokens.`,

  `Looking at this more carefully, the root cause is a race condition between the session refresh and the API call. I need to add proper synchronization.`,

  `The user's request involves modifying three files. I'll start with the type definitions since the other files depend on them.`,

  `I need to be careful here — changing this interface will affect all consumers. Let me check for downstream usage first.`,

  `This is a straightforward refactor. I'll extract the shared logic into a utility function and update both callers.`,

  `The build error is caused by a circular dependency between \`utils.ts\` and \`config.ts\`. I need to break the cycle by moving the shared type to a separate file.`,

  `I should run the full test suite after this change to make sure nothing else breaks. The change touches a core utility function.`,
]

// Tool call argument templates

export const readFileTargets = [
  'src/index.ts',
  'src/config.ts',
  'src/utils/helpers.ts',
  'package.json',
  'tsconfig.json',
  'README.md',
  'AGENTS.md',
  'src/handlers/auth.ts',
  'src/handlers/api.ts',
  'src/middleware/cors.ts',
  'src/types.ts',
  'src/database/schema.ts',
  'tests/auth.test.ts',
  'tests/api.test.ts',
  '.env.example',
  'src/routes/index.ts',
  'src/services/user.ts',
  'src/services/email.ts',
]

export const grepPatterns = [
  'processItems',
  'handleAuth',
  'TODO',
  'interface Config',
  'export default',
  'import.*from',
  'async function',
  'class.*extends',
]

export const findPatterns = [
  '*.test.ts',
  '*.config.*',
  'src/**/*.ts',
  '*.md',
]

export const lsTargets = [
  'src',
  'src/handlers',
  'tests',
  'src/services',
  '.',
  'src/utils',
  'src/routes',
]

export const bashCommands = [
  'npm run test',
  'npm run build',
  'npm run lint -- --fix',
  'git status',
  'git diff --stat',
  'npx tsc --noEmit',
  'npm run test -- --run tests/auth.test.ts',
  'cat package.json | jq .dependencies',
  'wc -l src/**/*.ts',
  'npm run dev -- --port 3001',
]

export const writeTargets = [
  'src/handlers/process.ts',
  'src/types.ts',
  'src/utils/validate.ts',
  'src/config.ts',
  'src/services/user.ts',
]

export const editTargets = [
  'src/index.ts',
  'src/handlers/auth.ts',
  'src/middleware/cors.ts',
  'tests/auth.test.ts',
  'src/routes/index.ts',
  'src/database/schema.ts',
]

// Helpers

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomAssistantFragment(): string {
  return pick(assistantFragments)
}

export function randomReasoningSummary(): string {
  return pick(reasoningSummaryFragments)
}

export interface MockToolCall {
  toolName: string
  args: Record<string, unknown>
}

export function randomToolCalls(count: number): MockToolCall[] {
  const tools: MockToolCall[] = []
  for (let i = 0; i < count; i++) {
    const kind = pick(
      ['read', 'grep', 'find', 'ls', 'bash', 'write', 'edit'] as const,
    )
    switch (kind) {
      case 'read':
        tools.push({ toolName: 'read', args: { path: pick(readFileTargets) } })
        break
      case 'grep':
        tools.push({
          toolName: 'grep',
          args: { pattern: pick(grepPatterns), path: '.' },
        })
        break
      case 'find':
        tools.push({
          toolName: 'find',
          args: { pattern: pick(findPatterns), path: '.' },
        })
        break
      case 'ls':
        tools.push({ toolName: 'ls', args: { path: pick(lsTargets) } })
        break
      case 'bash':
        tools.push({ toolName: 'bash', args: { command: pick(bashCommands) } })
        break
      case 'write':
        tools.push({
          toolName: 'write',
          args: { path: pick(writeTargets), content: '// updated content' },
        })
        break
      case 'edit':
        tools.push({
          toolName: 'edit',
          args: { path: pick(editTargets), old: 'old code', new: 'new code' },
        })
        break
    }
  }
  return tools
}

/** Generate a batch of exploration-heavy tool calls (more realistic). */
export function randomExplorationToolCalls(count: number): MockToolCall[] {
  const tools: MockToolCall[] = []
  for (let i = 0; i < count; i++) {
    // Weight towards read/grep/ls which are more common
    const r = Math.random()
    if (r < 0.4) {
      tools.push({ toolName: 'read', args: { path: pick(readFileTargets) } })
    } else if (r < 0.6) {
      tools.push({
        toolName: 'grep',
        args: { pattern: pick(grepPatterns), path: '.' },
      })
    } else if (r < 0.75) {
      tools.push({ toolName: 'ls', args: { path: pick(lsTargets) } })
    } else if (r < 0.85) {
      tools.push({
        toolName: 'find',
        args: { pattern: pick(findPatterns), path: '.' },
      })
    } else if (r < 0.93) {
      tools.push({ toolName: 'bash', args: { command: pick(bashCommands) } })
    } else {
      const editOrWrite = Math.random() < 0.5 ? 'write' : 'edit'
      const targets = editOrWrite === 'write' ? writeTargets : editTargets
      tools.push({
        toolName: editOrWrite,
        args: editOrWrite === 'write'
          ? { path: pick(targets), content: '// updated' }
          : { path: pick(targets), old: 'old', new: 'new' },
      })
    }
  }
  return tools
}

export function randomFinalSummary(): string {
  return pick([
    `All done! The changes have been applied and verified. Let me know if you'd like any adjustments.`,

    `I've completed the task. Here's a summary of what was done:

1. Fixed the root cause of the issue
2. Added test coverage for the edge case
3. Verified the build passes

Let me know if you have any questions!`,

    `The refactoring is complete. All tests pass and the build succeeds. The key changes were:

- Extracted shared logic into a reusable utility
- Updated both callers to use the new function
- Added proper error handling for edge cases`,

    `Everything looks good! The implementation is working as expected. I've verified it against the test suite and there are no regressions.`,

    `Done. The fix addresses the original issue and I've added a regression test to prevent it from happening again. The CI should pass now.`,
  ])
}
