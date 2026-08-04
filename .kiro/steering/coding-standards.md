---
inclusion: auto
---

# Coding Standards

Conventions for the Task API microservice. Keep things simple and idiomatic —
the application is intentionally small so the metrics instrumentation is the star.

## Language & Runtime

- TypeScript (strict mode)
- Node.js 20+
- ES modules (`"type": "module"` in package.json)

## Project Structure

```
kiro-metrics-demo/
  src/
    index.ts          # Express app entry point
    routes/           # Route handlers
    models/           # Data models / types
    services/         # Business logic
  tests/              # Test files (*.test.ts)
  scripts/
    metrics/          # Metrics computation scripts
    hooks/            # Git hook scripts (called by Kiro hooks)
  .kiro/
    steering/         # This folder
    hooks/            # Kiro agent hooks
```

## Style Rules

- Use `const` over `let`; never use `var`
- Prefer named exports over default exports
- Use explicit return types on all public functions
- Error handling: throw typed errors, catch at route boundary
- No `any` types — use `unknown` and narrow

## Testing

- Framework: vitest
- Naming: `*.test.ts` co-located in `tests/` mirror of `src/`
- Each route handler and service function has at least one test
- Use descriptive test names: `it('returns 404 when task does not exist')`

## Dependencies

- Express for HTTP (lightweight, well-known)
- zod for request validation
- uuid for task IDs
- No ORM — in-memory store is fine for this PoC

## API Design

- RESTful routes under `/api/tasks`
- JSON request/response bodies
- Standard HTTP status codes (200, 201, 400, 404, 409)
- Validation errors return `{ error: string, details?: unknown }`

## Documentation

- JSDoc on exported functions (brief — one line of purpose)
- No inline comments unless explaining a non-obvious decision
- README.md at project root explains how to run, test, and compute metrics
