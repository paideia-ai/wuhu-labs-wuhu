Meta rule

- By AGENTS.md, we refer to both AGENTS.md and AGENTS.local.md
- No Markdown header in AGENTS.md, only paragraph and lists
- Concise over grammar
- When working in a subfolder with AGENTS.md, read them if present

Project

- Wuhu is a self-hosted platform for managing/running background coding agents in sandboxes
- Coding agents are described in docs/what-are-coding-agents.md

Folders

- core: workspace for backend and sandboxes
- web: workspace for frontend UI
- deploy: k8s files for deployment
- docs: project-wide docs, each workspace/package can have its own docs

Deno and NodeJS

- We only use Deno
  - Existing NodeJS usage is okay
  - No new NodeJS usage
  - When review, always flag new NodeJS usage
- When adding/removing packages, use Deno cli, no manual deno.json/package.json edit
    - Do not specify package version manually, prefer latest whenever possible
- core and web are two different Deno workspaces
  - core: proper Deno, no node_modules, no package.json
  - web: with npm compat, nodeModulesDir set to auto, use package.json when needed

Git

- Always use squash merge to merge into main
- When asked for a feature/bugfix
  - Always create a new branch
  - Do it end-to-end, do not stop midway
  - Commit as you go
  - Perform local validations
  - Create a PR, make it green
    - If a PR is red, try reproduce issue locally; fix and verify locally before push again
  - Ask human to review
- Exceptions to above:
  - You are asked to do it interactively
  - Human just wants to chat/discuss
  - Repo has dirty work when you started
