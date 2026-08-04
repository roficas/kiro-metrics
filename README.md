# kiro-metrics

A CLI tool that reads AI code attribution data from git repositories and produces four-tier metrics reports. Built with [AWS Kiro](https://kiro.dev) to demonstrate how engineering leaders can measure agentic coding adoption with metrics their board will trust.

This is the companion code sample for the blog post **"Metrics your board will trust: measuring agentic coding for engineering leaders."**

## How it works

The system has two sides:

```
┌─────────────────────────────────────┐     ┌──────────────────────────────────────┐
│         WRITE SIDE                   │     │          READ SIDE                    │
│     (runs during development)        │     │      (runs on demand via CLI)         │
│                                      │     │                                       │
│  Kiro PostToolUse hook               │     │  Git Connector                        │
│    ↓ logs file edits                 │     │    ↓ reads commit history             │
│  .kiro-attribution.json              │     │  Consolidation Engine                 │
│    ↓ read at commit time             │     │    ↓ computes metrics                 │
│  Git hooks (pre-commit,              │     │  Report Generator                     │
│   prepare-commit-msg, post-commit)   │     │    ↓ audience-aware views             │
│    ↓ tags commits with trailers      │     │  Terminal / JSON / Markdown output    │
│  Git notes (ai-attribution ref)      │     │                                       │
└─────────────────────────────────────┘     └──────────────────────────────────────┘
```

**Write side:** Kiro hooks capture which files the AI agent edits. Git hooks convert that data into commit trailers (`ai-authored-by`, `ai-authorship`, `ai-lines`, `human-lines`) and git notes with file-level breakdowns.

**Read side:** The CLI reads commit history (local git or GitHub API), computes the blog post's four-tier metrics, and generates reports for three audiences.

## Prerequisites

- Node.js 20+
- git
- jq (for the write-side hooks)

## Installation

```bash
# Clone and install
git clone https://github.com/aws-samples/kiro-metrics-demo.git
cd kiro-metrics-demo
npm install

# Install the write-side hooks (in the repo you want to track)
./scripts/hooks/install-hooks.sh
```

## Usage

### Run metrics on a local repo

```bash
# Team view (default) — last 30 days
npx tsx src/index.ts --repo /path/to/your/repo

# Board summary — last 3 months
npx tsx src/index.ts --repo /path/to/your/repo --since 3m --view board

# Developer view — one contributor
npx tsx src/index.ts --repo /path/to/your/repo --view developer --author "Your Name"

# JSON output for programmatic use
npx tsx src/index.ts --repo /path/to/your/repo --format json

# Markdown for PRs or documentation
npx tsx src/index.ts --repo /path/to/your/repo --format md

# With CTS-SW calculation (provide hourly rate)
npx tsx src/index.ts --repo /path/to/your/repo --view board --hourly-rate 150
```

### Run metrics on a GitHub repo

```bash
export GITHUB_TOKEN=ghp_...
npx tsx src/index.ts --repo aws-samples/kiro-metrics-demo --since 30d --view team
```

### CLI flags

| Flag | Description | Default |
|---|---|---|
| `--repo <path-or-url>` | Local path or GitHub `owner/repo` | `.` (current directory) |
| `--since <date>` | Start of date range (ISO date or relative: `30d`, `3m`, `1y`) | `30d` |
| `--until <date>` | End of date range | `now` |
| `--author <name>` | Filter to one contributor | all |
| `--view <view>` | `developer`, `team`, or `board` | `team` |
| `--format <format>` | `terminal`, `json`, or `md` | `terminal` |
| `--hourly-rate <rate>` | Developer hourly rate for CTS-SW calculation | — |
| `--hours-per-commit <hours>` | Estimated hours per delivery unit | `2` |

## Metrics computed

These map directly to the blog post's four-tier framework:

### Tier 1: Adoption
- **AI Code Involvement Rate** = (commits with `ai-authored-by` trailer / total commits) × 100

### Tier 2: Impact
- **AI Code Authorship Rate** = (AI-authored lines / total lines) × 100
- **Delivery Frequency** = commits per week

### Tier 3: Cost to Serve Software
- **CTS-SW Proxy** = (hourly rate × hours per commit × total commits) / delivery units

### Tier 4: Tension (Guardrails)
- Board view includes automated guardrail assessment (authorship growth rate, review practices)

## Report views

### Team view (terminal)
```
╭──────────────────────────────────────────────────╮
│  AI Attribution Report — Team View               │
│  Period: 2026-07-05 to 2026-08-04                │
├──────────────────────────────────────────────────┤
│  AI Code Involvement Rate:  75%                  │
│  AI Code Authorship Rate:   62%                  │
│  Delivery Frequency:        8.2 commits/week     │
│                                                  │
│  By Author:                                      │
│    alice  80% involvement, 78% authorship        │
│    bob    45% involvement, 30% authorship        │
│                                                  │
│  Weekly Trend:                                   │
│    2026-07-07: involvement 60%  authorship 45%   │
│    2026-07-14: involvement 70%  authorship 55%   │
│    2026-07-21: involvement 75%  authorship 62%   │
╰──────────────────────────────────────────────────╯
```

### Board view (terminal)
```
╭──────────────────────────────────────────────────╮
│  AI Metrics — Board Summary                      │
│  Period: 2026-07-05 to 2026-08-04                │
├──────────────────────────────────────────────────┤
│  AI Code Involvement:   75% of commits           │
│  AI Code Authorship:    62% of lines             │
│  Delivery Frequency:    8.2 units/week           │
│  CTS-SW Proxy:          $420/delivery unit       │
│                                                  │
│  Trend: ↑ involvement +15pp, ↑ authorship +17pp │
│  Guardrail: healthy                              │
│    All guardrails within acceptable thresholds   │
╰──────────────────────────────────────────────────╯
```

## Adding the write-side hooks to your own project

To start collecting attribution data in any repo where you use Kiro:

### 1. Copy the Kiro agent hook

Add this to your project's `.kiro/hooks/track-ai-edits.json`:

```json
{
  "version": "v1",
  "hooks": [{
    "name": "Track AI File Edits",
    "trigger": "PostToolUse",
    "matcher": "fs_write|str_replace|fs_append",
    "action": {
      "type": "command",
      "command": "bash scripts/hooks/log-ai-edit.sh"
    }
  }]
}
```

### 2. Copy the git hooks

```bash
cp scripts/hooks/{log-ai-edit.sh,pre-commit,prepare-commit-msg,post-commit} your-project/scripts/hooks/
chmod +x your-project/scripts/hooks/*
cd your-project && ./scripts/hooks/install-hooks.sh
```

### 3. Add `.kiro-attribution.json` to .gitignore

```
.kiro-attribution.json
.kiro-attribution-staged.json
```

### 4. Run metrics

```bash
npx tsx /path/to/kiro-metrics-demo/src/index.ts --repo /path/to/your-project
```

## How attribution tracking works

See [ADR-001: AI Code Attribution](docs/decisions/001-ai-code-attribution.md) for the full design decision, including why we chose PostToolUse over other approaches.

The flow:
1. **During development** — Kiro's PostToolUse hook fires on every `fs_write`, `str_replace`, or `fs_append` and logs the file path to `.kiro-attribution.json`
2. **At commit time** — `pre-commit` reads the tracking file, counts AI vs human lines per staged file
3. **Commit message** — `prepare-commit-msg` appends trailers: `ai-authored-by: kiro`, `ai-authorship: generated|assisted`, `ai-lines: N`, `human-lines: M`
4. **After commit** — `post-commit` stores the full breakdown as a git note and clears tracking files

## Development

```bash
npm run test         # Run tests
npm run lint         # Run ESLint
npm run build        # Compile TypeScript
npm run metrics      # Run the CLI (alias for tsx src/index.ts)
```

## Related resources

- [Metrics your board will trust](../agentic-coding-adoption-blog-post/agentic-coding-adoption-blog-post.md) — the companion blog post
- [sample-kiro-coding-metrics-collector](https://github.com/aws-samples/sample-kiro-coding-metrics-collector) — AWS sample for production-grade line-level attribution
- [The Chef vs Cook Developer](../genai-developer-blog/blog-post.md) — individual-developer framing for agentic coding

## License

MIT-0
