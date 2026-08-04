# kiro-metrics

A CLI tool that reads AI code attribution data from git repositories and produces metrics reports. It tells you what percentage of your code was written by AI, broken down by commit, file, author, and week.

Companion code for the blog post **"Metrics your board will trust: measuring agentic coding for engineering leaders."**

## What it does

Two parts:

1. **Write side** — a Kiro hook + git hooks that automatically tag every commit with AI attribution data. No changes to your source files. Everything lives in commit messages and git notes.
2. **Read side** — a CLI that reads those tags from any repo and computes metrics.

## Quick start

### Make your project trackable (write side)

You need 5 files and one command. Nothing else changes in your project.

```bash
# 1. Copy the Kiro agent hook (tells Kiro to log its file edits)
mkdir -p .kiro/hooks
cp kiro-metrics-demo/.kiro/hooks/track-ai-edits.json  your-project/.kiro/hooks/

# 2. Copy the hook scripts
mkdir -p your-project/scripts/hooks
cp scripts/hooks/log-ai-edit.sh       your-project/scripts/hooks/
cp scripts/hooks/pre-commit           your-project/scripts/hooks/
cp scripts/hooks/prepare-commit-msg   your-project/scripts/hooks/
cp scripts/hooks/post-commit          your-project/scripts/hooks/
chmod +x your-project/scripts/hooks/*

# 3. Install the git hooks (symlinks them into .git/hooks/)
cd your-project
./scripts/hooks/install-hooks.sh

# 4. Add tracking files to .gitignore — do this BEFORE your first commit
echo ".kiro-attribution.json" >> .gitignore
echo ".kiro-attribution-staged.json" >> .gitignore
```

That's it. Start a new Kiro session and every commit will be automatically tagged.

> **Never commit the tracking files.** Both are ephemeral scratch state:
> `.kiro-attribution.json` is appended to by the Kiro hook and reset to `{"edits":[]}` by
> `post-commit`; `.kiro-attribution-staged.json` is written by `pre-commit` and deleted by
> `post-commit`. If you track them, every commit leaves your working tree dirty the instant
> it finishes, and they conflict on every merge. Durable attribution lives in the commit
> trailers and the `refs/notes/ai-attribution` ref, not in these files.
>
> Already committed them by mistake? Untrack them without deleting your local copies:
> ```bash
> git rm --cached .kiro-attribution.json .kiro-attribution-staged.json
> printf '.kiro-attribution.json\n.kiro-attribution-staged.json\n' >> .gitignore
> git commit -m "chore: untrack ephemeral attribution tracking files"
> ```

### What gets added to your commits

The hooks add **trailers to commit messages** (like `Signed-off-by` lines) and **git notes** on a separate ref. Your source files are never modified.

Example commit message after the hooks run:
```
feat: add user validation

ai-authored-by: kiro
ai-authorship: generated
ai-lines: 85
human-lines: 12
```

Example git note (stored in `refs/notes/ai-attribution`):
```json
{"ai_lines":85,"human_lines":12,"total_lines":97,"ai_files":["src/validation.ts","src/types.ts"],"human_files":["README.md"]}
```

### Read the metrics (read side)

```bash
# Install this tool
cd kiro-metrics-demo
npm install

# Run against any repo with the hooks installed
npx tsx src/index.ts --repo /path/to/your-project

# Different views
npx tsx src/index.ts --repo /path/to/your-project --view board
npx tsx src/index.ts --repo /path/to/your-project --view developer --author "Your Name"

# Different formats
npx tsx src/index.ts --repo /path/to/your-project --format json
npx tsx src/index.ts --repo /path/to/your-project --format md

# GitHub remote (requires GITHUB_TOKEN)
export GITHUB_TOKEN=ghp_...
npx tsx src/index.ts --repo owner/repo
```

## CLI flags

| Flag | Description | Default |
|---|---|---|
| `--repo <path-or-url>` | Local path or GitHub `owner/repo` | `.` |
| `--since <date>` | Start of range (`30d`, `3m`, `2026-07-01`) | `30d` |
| `--until <date>` | End of range | `now` |
| `--author <name>` | Filter to one contributor | all |
| `--view <view>` | `developer`, `team`, or `board` | `team` |
| `--format <format>` | `terminal`, `json`, or `md` | `terminal` |
| `--hourly-rate <rate>` | Hourly rate for CTS-SW calculation | — |
| `--hours-per-commit <hours>` | Hours per delivery unit | `2` |

## Metrics computed

| Metric | Formula | Tier |
|---|---|---|
| AI Code Involvement Rate | (commits with `ai-authored-by` / total commits) × 100 | Adoption |
| AI Code Authorship Rate | (AI lines / total lines) × 100 | Impact |
| Delivery Frequency | commits per week | Impact |
| CTS-SW Proxy | hourly rate × hours per commit | Cost |

## How the attribution tracking works

```
During Kiro session:
  Kiro edits a file
    → PostToolUse hook fires
    → log-ai-edit.sh appends {file, tool, timestamp} to .kiro-attribution.json

At commit time (git hooks):
  pre-commit
    → reads .kiro-attribution.json
    → checks which staged files appear in the tracking log
    → counts AI lines vs human lines
    → writes .kiro-attribution-staged.json

  prepare-commit-msg
    → reads the staged summary
    → appends trailers to commit message:
        ai-authored-by: kiro
        ai-authorship: generated | assisted | human-only
        ai-lines: N
        human-lines: M

  post-commit
    → stores full breakdown as git note (refs/notes/ai-attribution)
    → clears tracking files for next cycle
```

Key points:
- **Source files are never modified.** Attribution lives in commit metadata only.
- **No steering files required.** The hooks work purely by observing Kiro's tool calls.
- **Graceful degradation.** If git notes are missing, the CLI falls back to trailer data.
- **Works with any project.** Language-agnostic — tracks file edits regardless of what's in them.

## Prerequisites

- Node.js 20+ (for the CLI)
- git
- jq (for the hook scripts)
- Kiro (for the PostToolUse hook to fire)

## Troubleshooting

### Trailers show `human-only` with `ai-lines: 0` and `human-lines: 0`

Both counts being zero means `pre-commit` never found `.kiro-attribution.json` and fell through
to its "no tracking file" path. Almost always a working-directory problem: the hooks resolve the
tracking files from the repo root via `git rev-parse --show-toplevel`, so they work regardless of
the CWD git invokes them from. If you copied older versions of the scripts that used bare relative
paths (`TRACKING_FILE=".kiro-attribution.json"`), re-copy them from this repo.

Check whether something is overriding the hooks path:

```bash
git config core.hooksPath
```

If that prints a path other than `.git/hooks`, a wrapper (corporate git tooling, Husky, pre-commit
framework) owns your hooks. The symlinks in `.git/hooks/` are then ignored unless the wrapper
explicitly chains to them. Verify your hooks actually run by adding a temporary `echo` to
`pre-commit`, or run the chain manually:

```bash
bash scripts/hooks/pre-commit && cat .kiro-attribution-staged.json
```

### Trailers show `human-only` but you know Kiro edited the files

`pre-commit` classifies a staged file as AI-authored only if its path appears in
`.kiro-attribution.json`, and the match is an **exact string comparison** against the path git
reports in `git diff --cached --name-only` (repo-root-relative). Compare the two:

```bash
git diff --cached --name-only --diff-filter=AM
jq -r '.edits[].file' .kiro-attribution.json
```

Mismatches usually mean the Kiro hook logged a path relative to a subdirectory rather than the
repo root. Also note `post-commit` resets the log after every commit, so files edited before your
last commit won't be attributed in the next one.

### `.kiro-attribution.json` stays empty during a Kiro session

The `PostToolUse` hook isn't firing. Confirm `.kiro/hooks/track-ai-edits.json` exists, has
`"enabled": true`, and that its `matcher` covers the write tools (`fs_write|str_replace|fs_append`).
The hook only fires on agent edits — files you edit by hand are correctly counted as human lines.

### Working tree goes dirty immediately after every commit

You're tracking the ephemeral files. See the untracking steps in [Quick start](#make-your-project-trackable-write-side).

## Development

```bash
npm run test         # Run tests (24 passing)
npm run lint         # Run ESLint
npm run build        # Compile TypeScript
npm run metrics      # Run the CLI
```

## Remote metrics via GitHub Actions

By default, the GitHub API can't read git notes. To get full attribution data (including file-level breakdowns) when running against a remote repo, add the GitHub Actions workflow:

### Setup

1. Copy `.github/workflows/attribution-log.yml` to your repo
2. Push your notes ref so the action can read it:
   ```bash
   git push origin refs/notes/ai-attribution
   ```
3. The workflow runs on every push to `main` and appends attribution data to `metrics/attribution-log.jsonl`

### What the action does

On each push to `main`:
1. Fetches the `refs/notes/ai-attribution` ref
2. Iterates new commits since the last logged entry
3. Extracts trailers + notes for each commit
4. Appends a JSON line per commit to `metrics/attribution-log.jsonl`
5. Commits the updated file back to the repo

### How the CLI uses it

When you run `kiro-metrics --repo owner/repo`, the GitHub connector:
1. Tries to read `metrics/attribution-log.jsonl` from the repo (one API call, full data)
2. If the file doesn't exist, falls back to parsing commit messages via the commits API (trailers only, no file-level breakdown)

### Pushing git notes

Git notes live in a separate ref and aren't pushed by default:

```bash
git push origin refs/notes/ai-attribution
```

Or add to your push config so it happens automatically:
```bash
git config --add remote.origin.push refs/notes/ai-attribution
```

## Design decisions

See [ADR-001: AI Code Attribution](docs/decisions/001-ai-code-attribution.md) for why we chose PostToolUse over other approaches.

## Related

- [sample-kiro-coding-metrics-collector](https://github.com/aws-samples/sample-kiro-coding-metrics-collector) — AWS sample for production-grade line-level attribution
- [AWS Kiro](https://kiro.dev)

## License

MIT-0
