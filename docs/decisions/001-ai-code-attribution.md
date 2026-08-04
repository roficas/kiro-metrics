# ADR-001: AI Code Attribution via PostToolUse Hook + Git Hooks

**Status:** Accepted  
**Date:** 2026-08-04  
**Deciders:** roficas  

## Context

The blog post "Metrics your board will trust" defines two attribution formulas:

- **AI Code Involvement Rate** = (AI-touched commits / Total commits) x 100  
- **AI Code Authorship Rate** = (AI-authored lines / Total lines) x 100  

To compute these with defensible accuracy, we need to know which files and lines
were written by the AI agent versus a human. The common approaches are:

1. **Tag the entire commit** — mark every commit made during an AI session as "AI-generated."
   Simple but imprecise: a single commit often mixes AI and human edits.

2. **Heuristic detection** — post-hoc tools that guess AI authorship from code patterns.
   Unreliable, not reproducible, and not defensible at board level.

3. **Capture at edit time** — record which files the agent touched as it works, then
   reconcile at commit time. Precise, observable, reproducible.

## Decision

We use approach 3: **capture at edit time** using Kiro's PostToolUse hook.

### How it works

```
┌─────────────────────────────────────────────────────────────────┐
│ During development (continuous)                                   │
│                                                                   │
│  Kiro edits file ──► PostToolUse hook fires ──► log-ai-edit.sh  │
│                                                   │               │
│                                         writes to ▼               │
│                                   .kiro-attribution.json          │
│                                   (file, tool, timestamp)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ At commit time (git hooks)                                        │
│                                                                   │
│  pre-commit ──► reads .kiro-attribution.json                     │
│              ──► cross-refs staged files                          │
│              ──► counts AI lines vs human lines                   │
│              ──► writes .kiro-attribution-staged.json             │
│                                                                   │
│  prepare-commit-msg ──► reads staged summary                     │
│                      ──► appends trailers:                        │
│                           ai-authored-by: kiro                    │
│                           ai-authorship: generated|assisted       │
│                           ai-lines: N                             │
│                           human-lines: M                          │
│                                                                   │
│  post-commit ──► stores attribution as git note (ai-attribution) │
│              ──► clears tracking files for next cycle             │
└─────────────────────────────────────────────────────────────────┘
```

### Why PostToolUse over other triggers

| Trigger | What it captures | Why we chose/rejected it |
|---|---|---|
| **PostToolUse** (fs_write, str_replace, fs_append) | Every individual file edit by the agent | Chosen — precise, per-file, per-edit granularity |
| PostFileSave | Files saved (by human or agent) | Rejected — no way to distinguish AI vs human saves |
| Stop (session end) | Session ended | Rejected — too coarse; entire session tagged, not individual edits |
| Git commit-msg hook alone | Commit being made | Rejected — tags whole commit; can't split mixed AI+human work |

### Attribution categories

The prepare-commit-msg hook classifies each commit:

| Category | Condition | Trailer value |
|---|---|---|
| AI-generated | All staged lines are in AI-tracked files | `ai-authorship: generated` |
| AI-assisted | Some staged lines are AI, some are human | `ai-authorship: assisted` |
| Human-only | No staged files appear in tracking log | `ai-authorship: human-only` |

### What this enables

1. **AI Code Involvement Rate** — query git log for commits with `ai-authored-by: kiro` trailer
2. **AI Code Authorship Rate** — sum `ai-lines` and `human-lines` trailers across commits
3. **Per-file attribution** — git notes contain the file-level breakdown
4. **Audience-aware reporting** — aggregate at commit, PR, or repo level for different audiences
5. **Reproducibility** — attribution is recorded at the time of work, not guessed after the fact

## Consequences

### Positive
- Line-level attribution is defensible (observed, not inferred)
- Works with any git hosting platform (GitHub, GitLab, CodeCommit)
- Git notes don't pollute commit messages beyond the trailers
- Tracking file (.kiro-attribution.json) is ephemeral — cleared each commit cycle

### Negative
- Requires jq installed on the developer's machine
- If a human edits a file that Kiro also edited (same session, before commit), the entire file's lines count as AI — granularity is file-level, not true line-level within a file
- Git notes need explicit push (`git push origin refs/notes/ai-attribution`) to reach remotes

### Mitigations
- Document jq as a prerequisite in README
- The file-level approximation is acceptable for the PoC; true line-level (diff-range tracking) is a future enhancement
- Add a `push-notes` npm script for convenience

## Alternatives Considered

1. **Kiro's sample-kiro-coding-metrics-collector** — uses git-ai and Git Notes. Our approach is compatible and simpler for the PoC scope; the sample repo is a reference for production hardening.

2. **AI detection tools (post-hoc)** — unreliable, not reproducible, actively discouraged by the blog post.

3. **Manual tagging** — developer remembers to add trailers. Error-prone, defeats automation.
