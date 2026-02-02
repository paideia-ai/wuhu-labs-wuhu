# Sandbox Daemon TODO

This file tracks the next concrete steps for the sandbox daemon package.

## Protocol 0 / Pi integration (hardening)

- Audit for secret leakage:
  - Ensure `SandboxDaemonCredentialsPayload` is never appended to the event
    stream.
  - Ensure logs never print secrets (only booleans / redacted).
- Increase test coverage for the “real Pi process” transport
  (`ProcessPiTransport`):
  - Spawn/kill lifecycle, line framing, error cases (transport not started, bad
    JSON).

## Auth (more negative cases)

- Add tests for invalid JWT paths:
  - malformed token, bad signature, unsupported alg, expired `exp`, issuer
    mismatch.

## Workspace cloning (edge cases)

- Add tests for clone/checkout edge cases:
  - repo path exists but is non-empty and not a git repo → error.
  - repo already cloned → no re-clone; branch checkout behavior.
  - path traversal / outside-workspace rejection.

## Git checkpoint mode (extras)

- Add tests for `push: true` with a local bare remote (success + failure cases).
- Add tests for “no staged changes” path (should not emit checkpoint event).

## Coverage follow-up

- Keep `coverage:check` above the agreed minimum for `src/` and raise the bar
  over time.
- Focus coverage on the least-covered modules first:
  - `src/pi-agent-provider.ts`, `src/git-checkpoint.ts`, `src/workspace.ts`.
