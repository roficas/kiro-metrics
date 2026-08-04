# Design: Metrics Reader Pipeline

## Architecture

Three-stage pipeline: connector → consolidation → report.

```
                    ┌─────────────────────────────────────────────┐
                    │              CLI Entrypoint                   │
                    │  Parses args, selects connector, orchestrates │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │            Connector Layer                    │
                    │                                               │
                    │  ┌─────────────┐    ┌──────────────────┐     │
                    │  │ LocalGitSrc │    │  GitHubApiSrc    │     │
                    │  │ (git log)   │    │  (REST API)      │     │
                    │  └──────┬──────┘    └────────┬─────────┘     │
                    │         └──────────┬─────────┘               │
                    │                    │                          │
                    │              CommitData[]                     │
                    └────────────────────┬─────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────────┐
                    │         Consolidation Engine                   │
                    │                                               │
                    │  - Involvement Rate                           │
                    │  - Authorship Rate                            │
                    │  - Delivery Frequency                         │
                    │  - CTS-SW Proxy                               │
                    │  - Per-file breakdown                         │
                    │  - Per-author breakdown                       │
                    │  - Weekly trend                               │
                    │                                               │
                    │              MetricsResult                    │
                    └────────────────────┬─────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────────┐
                    │           Report Generator                     │
                    │                                               │
                    │  ┌───────────┐ ┌──────────┐ ┌─────────────┐ │
                    │  │ Developer │ │   Team   │ │    Board    │ │
                    │  │   View    │ │   View   │ │    View     │ │
                    │  └───────────┘ └──────────┘ └─────────────┘ │
                    │                                               │
                    │  Output: terminal | JSON | Markdown           │
                    └──────────────────────────────────────────────┘
```

## Data Models

### CommitData (connector output)

```typescript
interface CommitData {
  sha: string;
  author: string;
  authorEmail: string;
  date: string;              // ISO 8601
  message: string;
  trailers: {
    aiAuthoredBy?: string;   // "kiro" if present
    aiAuthorship?: "generated" | "assisted" | "human-only";
    aiLines?: number;
    humanLines?: number;
  };
  notes?: {                  // From git notes --ref=ai-attribution
    ai_lines: number;
    human_lines: number;
    total_lines: number;
    ai_files: string[];
    human_files: string[];
  };
}
```

### MetricsResult (consolidation output)

```typescript
interface MetricsResult {
  period: { since: string; until: string };
  summary: {
    totalCommits: number;
    aiInvolvedCommits: number;
    involvementRate: number;       // percentage
    totalAiLines: number;
    totalHumanLines: number;
    authorshipRate: number;        // percentage
    deliveryFrequency: number;     // commits per week
    ctsSwProxy?: number;           // cost per delivery unit (if hourly rate provided)
  };
  byFile: Array<{
    file: string;
    aiLines: number;
    humanLines: number;
    authorshipRate: number;
  }>;
  byAuthor: Array<{
    author: string;
    email: string;
    totalCommits: number;
    aiInvolvedCommits: number;
    aiLines: number;
    humanLines: number;
  }>;
  weeklyTrend: Array<{
    weekStart: string;             // ISO date (Monday)
    involvementRate: number;
    authorshipRate: number;
    commitCount: number;
  }>;
}
```

## Connector Design

### LocalGitSource

Uses `child_process.execSync` to run git commands:

```bash
# Get commits with trailers
git log --format='%H|%an|%ae|%aI|%s|%(trailers:key=ai-authored-by,valueonly)|%(trailers:key=ai-authorship,valueonly)|%(trailers:key=ai-lines,valueonly)|%(trailers:key=human-lines,valueonly)' --since="2026-07-01"

# Get git notes
git notes --ref=ai-attribution show <sha>
```

### GitHubApiSource

Uses GitHub REST API (`/repos/{owner}/{repo}/commits`):
- Paginate commits with `since`/`until` params
- Parse trailers from commit message body
- Git notes: fetch via `/repos/{owner}/{repo}/git/refs/notes/ai-attribution` then read blob content

Auth: `GITHUB_TOKEN` env var → Bearer token in Authorization header.

## Report Views

### Developer View
```
╭──────────────────────────────────────────────╮
│  AI Attribution Report — Developer View       │
│  Repo: devs-with-genai  Period: last 30 days │
├──────────────────────────────────────────────┤
│  Your commits: 15                             │
│  AI-involved: 12 (80%)                        │
│  AI-authored lines: 1,240 / 1,580 (78%)      │
│                                               │
│  Top AI-authored files:                       │
│    src/connector.ts          95% AI           │
│    src/consolidation.ts      88% AI           │
│    tests/connector.test.ts   72% AI           │
╰──────────────────────────────────────────────╯
```

### Team View
```
╭──────────────────────────────────────────────╮
│  AI Attribution Report — Team View            │
│  Repo: devs-with-genai  Period: last 30 days │
├──────────────────────────────────────────────┤
│  AI Code Involvement Rate:  75%               │
│  AI Code Authorship Rate:   62%               │
│  Delivery Frequency:        8.2 commits/week  │
│                                               │
│  By Author:                                   │
│    roficas      80% involvement, 78% author.  │
│    contributor  45% involvement, 30% author.  │
│                                               │
│  Weekly Trend:                                │
│    Jul 7:  involvement 60%  authorship 45%    │
│    Jul 14: involvement 70%  authorship 55%    │
│    Jul 21: involvement 75%  authorship 62%    │
╰──────────────────────────────────────────────╯
```

### Board View
```
╭──────────────────────────────────────────────╮
│  AI Metrics — Board Summary                   │
│  Repo: devs-with-genai  Period: last 30 days │
├──────────────────────────────────────────────┤
│  AI Code Involvement:   75% of commits        │
│  AI Code Authorship:    62% of lines          │
│  Delivery Frequency:    8.2 units/week        │
│  CTS-SW Proxy:          $420/delivery unit    │
│                                               │
│  Trend: ↑ involvement +15pp, ↑ authorship +17pp │
│  Guardrail: lint errors stable, tests passing │
╰──────────────────────────────────────────────╯
```

## File Structure

```
kiro-metrics-demo/
  src/
    index.ts                  # CLI entrypoint (arg parsing, orchestration)
    connector/
      types.ts                # CommitData interface
      local-git.ts            # LocalGitSource — reads from local repo
      github-api.ts           # GitHubApiSource — reads from GitHub REST API
      index.ts                # Factory: pick source based on --repo flag
    consolidation/
      types.ts                # MetricsResult interface
      engine.ts               # Computes all metrics from CommitData[]
    report/
      types.ts                # Report options (view, format)
      developer.ts            # Developer view renderer
      team.ts                 # Team view renderer
      board.ts                # Board view renderer
      formatters/
        terminal.ts           # Terminal (box-drawing) formatter
        json.ts               # JSON output
        markdown.ts           # Markdown output
  tests/
    connector/
      local-git.test.ts
    consolidation/
      engine.test.ts
    report/
      team.test.ts
    fixtures/
      sample-commits.json     # Mock CommitData[] for unit tests
  scripts/
    hooks/                    # (existing) write-side git hooks
```

## Design Decisions

1. **Local git first, GitHub API second** — local mode has zero auth friction and works offline; GitHub mode extends reach to CI/CD and remote reporting.
2. **Git trailers as primary data** — trailers are part of the commit message and survive rebases, cherry-picks, and force-pushes. Git notes are supplementary (richer, but fragile).
3. **Graceful degradation** — if notes are missing, fall back to trailer-only computation. Involvement rate always works; authorship rate needs at least `ai-lines`/`human-lines` trailers.
4. **Audience-aware by design** — the three views are baked into the architecture, not bolted on. This mirrors the blog post's metrics audience funnel.
5. **No native deps** — pure TypeScript + child_process for git commands. Runs anywhere Node runs.
6. **Configurable CTS-SW** — hourly rate and delivery unit type are CLI flags, not hardcoded. Keeps the formula honest per the blog post's guidance.
