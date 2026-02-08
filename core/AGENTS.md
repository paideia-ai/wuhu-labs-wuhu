# AGENTS.md (core)

## Core Tasks (Deno)

Run from `core/`:

```bash
deno task verify          # Typecheck + lint + tests
deno task check           # Typecheck only
deno task test            # Run tests
deno task coverage        # Generate coverage report
deno task coverage:check  # Fail if below threshold (default 80%)
```

Override coverage threshold: `COVERAGE_MIN=0.7 deno task coverage:check`
