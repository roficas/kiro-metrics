---
inclusion: auto
---

# Metrics Standards

Rules for commit attribution, delivery unit tracking, and quality guardrails.
These conventions enable the four-tier metrics framework described in the companion blog post.

## Commit Attribution

Every commit that contains AI-generated or AI-assisted code MUST include a git trailer:

```
ai-authored-by: kiro
```

### Attribution categories

| Category | Definition | How to tag |
|---|---|---|
| AI-generated | Code authored entirely by the agent from a prompt or spec | `ai-authorship: generated` trailer |
| AI-assisted | Code written by a human with AI suggestions along the way | `ai-authorship: assisted` trailer |
| Human-only | Code written without AI involvement | No AI trailer needed |

### Line-level tracking

When possible, use git notes to record line-count attribution per commit:

```
git notes add -m '{"ai_lines": N, "human_lines": M, "total_lines": T}'
```

This feeds the AI Code Authorship Rate formula:
`AI Code Authorship Rate = (Lines Authored by AI / Total Lines Committed) x 100`

## Delivery Unit

This project uses **merged pull requests** as its delivery unit (monolithic app pattern).

The Cost to Serve Software formula is:
`CTS-SW = (Dev Cost + Infra Cost) / Merged PRs`

For this PoC, Dev Cost is approximated as developer-hours and AI inference cost.

## Quality Guardrails (Tension Metrics)

Every accelerator metric has a paired guardrail. Do not celebrate speed gains without
checking the guardrail:

| Accelerator | Guardrail | Threshold |
|---|---|---|
| PR cycle time | Test pass rate | Must stay above 95% |
| Deployment frequency | Lint error count | Must not increase |
| AI code involvement | Security findings | Must not increase per release |

### The 10% rule

If a guardrail degrades by more than 10% while its paired accelerator improves,
the improvement is suspect and must be investigated before reporting.

## Metric Computation

Scripts in `scripts/metrics/` compute:

1. **AI Code Involvement Rate** = (AI-touched commits / Total commits) x 100
2. **AI Code Authorship Rate** = (AI-authored lines / Total lines) x 100
3. **Deployment frequency proxy** = Merged PRs per week
4. **CTS-SW proxy** = Total dev-hours / Merged PRs
