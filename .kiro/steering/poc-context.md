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

A "Task API" microservice (Node.js/TypeScript) — simple CRUD with status transitions.
The application itself is intentionally small. The real deliverable is the metrics
instrumentation layer around it:

1. Git commit attribution (AI-generated vs AI-assisted vs human)
2. Hooks that tag commits and enforce quality gates
3. Scripts that compute the four-tier metrics (adoption, impact, CTS-SW, tension)
4. Audience-aware reporting (developer view, team lead view, board view)

## Key concepts from the blog post this demonstrates

- The metrics trap (lines of code, accept rates, hours saved are anti-patterns)
- Four-tier framework: adoption -> impact -> Cost to Serve Software -> tension
- AI Code Involvement Rate and AI Code Authorship Rate formulas
- Goodhart's Law defense via accelerator/guardrail pairings
- Metrics audience funnel (four tiers of reporting)

## Technical decisions

- Language: TypeScript (Node.js)
- No Brazil — this is a public-facing sample, not internal tooling
- Delivery unit: merged PR (monolithic app pattern)
- Test framework: vitest
- Linter: eslint
- Package manager: npm

## Repo conventions

- All commits from Kiro carry an `ai-authored-by: kiro` git trailer
- Line-level attribution tracked via git notes
- Every PR requires passing tests (tension guardrail)
