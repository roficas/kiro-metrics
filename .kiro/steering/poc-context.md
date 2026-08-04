---
inclusion: auto
---

# PoC Context: Measuring Agentic Coding with Kiro

## What this project is

A public-facing code sample that demonstrates how to measure agentic coding adoption
using AWS Kiro. It accompanies the blog post "Metrics your board will trust: measuring
agentic coding for engineering leaders."

## The meta-point

This project is built using Kiro's Spec-Driven Development workflow, which means the
PoC collects metrics about its own development. The hooks, attribution tagging, and
measurement scripts we build here are exercised live as Kiro works through the spec tasks.

## What we're building

A metrics reader pipeline (Node.js/TypeScript CLI) that reads AI code attribution data
from any git repository and produces four-tier metrics reports. The system has two sides:

**Write side** (already built):
1. Kiro PostToolUse hook — logs every agent file-write
2. Git hooks (pre-commit, prepare-commit-msg, post-commit) — compute and tag attribution

**Read side** (the pipeline):
1. Git connector — reads commits, trailers, and git notes (local or GitHub API)
2. Consolidation engine — computes involvement rate, authorship rate, delivery frequency, CTS-SW
3. Report generator — audience-aware views (developer, team, board)
4. CLI entrypoint — `kiro-metrics --repo <path-or-owner/repo> --view team`

No sample app. The hooks get added to any real project; this tool reads the results.

## Key concepts from the blog post this demonstrates

- The metrics trap (lines of code, accept rates, hours saved are anti-patterns)
- Four-tier framework: adoption -> impact -> Cost to Serve Software -> tension
- AI Code Involvement Rate and AI Code Authorship Rate formulas
- Goodhart's Law defense via accelerator/guardrail pairings
- Metrics audience funnel (four tiers of reporting)

## Technical decisions

- Language: TypeScript (Node.js)
- No Brazil — this is a public-facing sample, not internal tooling
- CLI framework: commander
- HTTP client: node-fetch (for GitHub API)
- Test framework: vitest
- Linter: eslint
- Package manager: npm

## Repo conventions

- All commits from Kiro carry an `ai-authored-by: kiro` git trailer
- Line-level attribution tracked via git notes
- Every PR requires passing tests (tension guardrail)
- The pipeline reads from any repo — you add the hooks to your project, then point kiro-metrics at it
