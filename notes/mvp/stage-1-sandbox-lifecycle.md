# Stage 1: Basic Sandbox Lifecycle

No agent execution yet - validate sandbox lifecycle and routing.

## Web UI - Create Sandbox

- Just a button/name to spawn a sandbox
- Creates a K8s Job
- Daemon starts but doesn't execute agent

## Sandbox Daemon

- Daemon runs its own HTTP API (control plane)
- Daemon spawns a separate **preview server** (dummy static HTTP on random port)
- No Pi agent execution yet

## Preview URL Routing

- Traefik plugin routes `<sandbox-id>-<port>.wuhu.liu.ms` to pod
- See architecture.md for plugin details

## Web UI - Task Detail

- Show preview URL for the static server (easy copy)
- Pattern: `<sandbox-id>-<port>.wuhu.liu.ms`

## Web UI - Sandbox List

- Show all active sandboxes
- Kill button → daemon shutdown → Job terminates

## Validates

- Job creation/termination
- Port exposure/routing
- UI flow
