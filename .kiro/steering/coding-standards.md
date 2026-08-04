---
inclusion: auto
---

# Coding Standards

Conventions for the kiro-metrics CLI pipeline. Keep things simple and idiomatic —
the tool should be easy to read, extend, and contribute to as a public sample.

## Language & Runtime

- TypeScript (strict mode)
- Node.js 20+
- ES modules (`"type": "module"` in package.json)

## Project Structure

```
kiro-metrics-demo/
  src/
    index.ts              # CLI entrypoint (commander, orchestration)
    connector/
      types.ts            # CommitData interface
      local-git.ts        # Reads from local git repo
      github-api.ts       # Reads from GitHub REST API
      index.ts            # Connector factory
    consolidation/
      types.ts            # MetricsResult interface
      engine.ts           # Computes all metrics
    report/
      types.ts            # Report options
      developer.ts        # Developer view
      team.ts             # Team view
      board.ts            # Board view
      formatters/
        terminal.ts       # Box-drawing terminal output
        json.ts           # JSON output
        markdown.ts       # Markdown output
  tests/                  # Test files (*.test.ts)
    connector/
    consolidation/
    report/
    fixtures/             # Mock data for unit tests
  scripts/
    hooks/                # Git hook scripts (write side)
  .kiro/
    steering/             # This folder
    hooks/                # Kiro agent hooks
    specs/                # Kiro spec (metrics-pipeline)
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

- commander for CLI argument parsing
- No HTTP framework — this is a CLI tool, not a server
- child_process (Node built-in) for git commands
- node native fetch (Node 20+) for GitHub API calls

## API Design

- CLI-first: all output goes to stdout, errors to stderr
- Use commander for arg parsing with clear --help output
- Functions return typed data structures; formatters handle rendering
- Connectors implement a common interface returning CommitData[]

## Documentation

- JSDoc on exported functions (brief — one line of purpose)
- No inline comments unless explaining a non-obvious decision
- README.md at project root explains how to run, test, and compute metrics
