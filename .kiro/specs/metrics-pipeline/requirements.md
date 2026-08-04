# Requirements: Metrics Reader Pipeline

## Overview

A CLI tool that reads AI code attribution data from any git repository (local or via
GitHub API) and produces four-tier metrics reports. It is the "read side" of the attribution
system — the "write side" is the Kiro hooks + git hooks that tag commits during development.

The pipeline is repo-agnostic: point it at any repo that uses the attribution hooks and it
computes the metrics defined in the companion blog post.

## Functional Requirements

### FR-1: Data Source — Git Connector

- FR-1.1: Read commit history from a local git repository (default mode)
- FR-1.2: Read commit history from a GitHub repository via REST API (remote mode)
- FR-1.3: Parse git trailers from commit messages (`ai-authored-by`, `ai-authorship`, `ai-lines`, `human-lines`)
- FR-1.4: Read git notes from the `ai-attribution` ref (contains per-commit file-level attribution JSON)
- FR-1.5: Support filtering by date range (`--since`, `--until`)
- FR-1.6: Support filtering by author (`--author`)
- FR-1.7: For GitHub mode, authenticate via `GITHUB_TOKEN` environment variable or `gh` CLI auth

### FR-2: Consolidation Engine — Metric Computation

- FR-2.1: Compute **AI Code Involvement Rate** = (commits with `ai-authored-by` trailer / total commits) x 100
- FR-2.2: Compute **AI Code Authorship Rate** = (sum of `ai-lines` across commits / sum of `ai-lines` + `human-lines`) x 100
- FR-2.3: Compute **Deployment Frequency proxy** = total merged PRs (or commits to main) per week
- FR-2.4: Compute **CTS-SW proxy** = total dev-hours estimate / delivery units (configurable denominator)
- FR-2.5: Compute **Authorship breakdown by file** — which files have highest AI authorship percentage
- FR-2.6: Compute **Authorship breakdown by author** — per-developer AI vs human contribution
- FR-2.7: Compute **Trend over time** — weekly rolling values for involvement and authorship rates

### FR-3: Report Generator — Audience-Aware Views

- FR-3.1: **Developer view** — per-file attribution, personal AI vs human line split, recent commit details
- FR-3.2: **Team view** — aggregate involvement rate, authorship rate, deployment frequency, top AI-authored files, per-author breakdown
- FR-3.3: **Board view** — single-page summary: involvement rate, authorship rate, CTS-SW proxy, trend sparkline description, accelerator/guardrail status
- FR-3.4: Output formats: terminal (default), JSON, Markdown

### FR-4: CLI Interface

- FR-4.1: Entrypoint: `npx kiro-metrics` or `npm run metrics`
- FR-4.2: Flags:
  - `--repo <path-or-url>` — local path or GitHub `owner/repo` (default: current directory)
  - `--since <date>` — start of date range (ISO date or relative like `30d`, `3m`)
  - `--until <date>` — end of date range (default: now)
  - `--author <name-or-email>` — filter to one contributor
  - `--view <developer|team|board>` — which audience report (default: team)
  - `--format <terminal|json|md>` — output format (default: terminal)
- FR-4.3: Sensible defaults: current directory, last 30 days, team view, terminal output
- FR-4.4: Exit code 0 on success, 1 on error with descriptive message

## Non-Functional Requirements

### NFR-1: Performance

- NFR-1.1: Handle repositories with up to 10,000 commits in under 30 seconds (local mode)
- NFR-1.2: GitHub API mode respects rate limits and paginates correctly

### NFR-2: Error Handling

- NFR-2.1: Clear error message if repo has no attribution data (suggests installing hooks)
- NFR-2.2: Graceful degradation: if git notes are missing, compute from trailers only
- NFR-2.3: If GitHub token is missing in remote mode, explain how to set it

### NFR-3: Portability

- NFR-3.1: Runs on macOS and Linux
- NFR-3.2: Requires only Node.js 20+ and git installed
- NFR-3.3: No native dependencies (pure JS/TS)

### NFR-4: Testing

- NFR-4.1: Unit tests for consolidation engine (metric formulas)
- NFR-4.2: Integration test that runs against the current repo's actual git history
- NFR-4.3: Tests use fixture data (mock git log output) for reproducibility

## Out of Scope

- Web UI / dashboard (terminal + markdown + JSON is sufficient for PoC)
- Real-time streaming / watching for new commits
- Multi-repo aggregation in a single run (run once per repo, combine externally)
- Cost data ingestion (CTS-SW uses a configurable hourly rate estimate, not real billing)
