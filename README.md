# kiro-metrics

A CLI tool that reads AI code attribution data from git repositories and produces metrics reports. It tells you what percentage of your code was written by AI, broken down by commit, file, author, and week.

Companion code for the blog post **"Metrics your board will trust: measuring agentic coding for engineering leaders."**

## What it does

Two parts:

1. **Write side** — a Kiro hook + git hooks that automatically tag every commit with AI attribution data. No changes to your source files. Everything lives in commit messages and git notes.
2. **The contract** — CI (GitHub Actions *or* GitLab CI) rebuilds a standard artifact, `metrics/attribution-log.jsonl`, and commits it to the repo. This is the boundary between the two sides.
3. **Read side** — a CLI that reads that artifact and computes metrics. It never talks to a git-host API and never touches git, so GitHub, GitLab, and self-hosted GitLab all work identically.

## Quick start

### Make your project trackable (write side)

You need 6 files and one command. Nothing else changes in your project.

```bash
# 1. Copy the Kiro agent hooks (capture probe + edit logger)
mkdir -p .kiro/hooks
cp kiro-metrics-demo/.kiro/hooks/track-ai-edits.json  your-project/.kiro/hooks/

# 2. Copy the hook scripts
mkdir -p your-project/scripts/hooks
cp scripts/hooks/log-ai-edit.sh        your-project/scripts/hooks/
cp scripts/hooks/mark-session-start.sh your-project/scripts/hooks/
cp scripts/hooks/pre-commit            your-project/scripts/hooks/
cp scripts/hooks/prepare-commit-msg    your-project/scripts/hooks/
cp scripts/hooks/post-commit           your-project/scripts/hooks/
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
{"attribution_state":"measured","ai_lines":85,"human_lines":12,"total_lines":97,"ai_files":["src/validation.ts","src/types.ts"],"human_files":["README.md"]}
```

`ai-authorship` is `generated` (no human lines), `assisted` (both), or `human-only`.
`ai-authored-by` is omitted for `human-only` commits.

There is a fourth possibility. If attribution could not be determined, the commit gets a
single different trailer instead, and no line counts:

```
ai-attribution: unknown
```

The omission is deliberate — it makes parsers exclude the commit from the authorship rate
rather than counting every line as human. See
[Verifying capture](#verifying-capture-before-you-trust-the-numbers).

### Read the metrics (read side)

```bash
# Install this tool
cd kiro-metrics-demo
npm install

# Run against a local checkout (reads its metrics/attribution-log.jsonl)
npx tsx src/index.ts --repo /path/to/your-project

# Different views
npx tsx src/index.ts --repo /path/to/your-project --view board
npx tsx src/index.ts --repo /path/to/your-project --view developer --author "Your Name"

# Different formats
npx tsx src/index.ts --repo /path/to/your-project --format json
npx tsx src/index.ts --repo /path/to/your-project --format md

# Self-contained HTML report (inlined CSS, no external requests) (semi-tested)
npx tsx src/index.ts --repo /path/to/your-project --format html > attribution-report.html

# Remote — point at the raw URL of the committed log (any host)
npx tsx src/index.ts --repo https://raw.githubusercontent.com/owner/repo/main/metrics/attribution-log.jsonl
npx tsx src/index.ts --repo https://gitlab.aws.dev/group/proj/-/raw/main/metrics/attribution-log.jsonl

# Private repo? Export a token (host-agnostic, sent as a Bearer header)
export METRICS_TOKEN=<token>
npx tsx src/index.ts --repo https://gitlab.aws.dev/group/proj/-/raw/main/metrics/attribution-log.jsonl
```

## CLI flags

| Flag | Description | Default |
|---|---|---|
| `--repo <path-or-url>` | Local repo/dir path, or a raw URL to `metrics/attribution-log.jsonl` | `.` |
| `--since <date>` | Start of range (`30d`, `3m`, `2026-07-01`) | `30d` |
| `--until <date>` | End of range | `now` |
| `--author <name>` | Filter to one contributor | all |
| `--view <view>` | `developer`, `team`, or `board` | `team` |
| `--format <format>` | `terminal`, `json`, `md`, or `html` | `terminal` |
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
At session start:
  SessionStart hook fires
    → mark-session-start.sh pushes a synthetic payload through log-ai-edit.sh
    → confirms an entry actually landed, then removes it
    → records {hooksAlive, captureVerified} in .kiro-attribution.json

During Kiro session:
  Kiro edits a file
    → PostToolUse hook fires
    → log-ai-edit.sh appends {file, tool, timestamp} to .kiro-attribution.json

At commit time (git hooks):
  pre-commit
    → reads .kiro-attribution.json
    → if capture was never verified and nothing was logged, stops here and
      records attribution_state: unknown rather than guessing
    → otherwise checks which staged files appear in the tracking log
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
- **Missing data is reported, not guessed.** If capture is not working, commits are marked
  `unknown` and excluded from the metrics rather than being reported as human-authored.

### Verifying capture before you trust the numbers

An empty `.kiro-attribution.json` is ambiguous: the agent may have edited nothing, or its
edits may never have been captured. Reporting the first when the second is true is the most
damaging way this tool can fail, because it records agent work as human work and it does so
in the flattering direction, with no error anywhere.

Two things must both hold, and they can fail independently:

| Claim | Meaning | Proven by |
|---|---|---|
| `hooksAlive` | the client executes hooks at all | `SessionStart` running |
| `captureVerified` | the logger understood the payload | a synthetic edit landing |

Liveness alone is not enough. A live hook writing nothing looks exactly like a session with
no AI edits — that is how the snake_case payload bug stayed invisible. `pre-commit` therefore
gates on `captureVerified`.

Check it any time:

```bash
jq -c '.session' .kiro-attribution.json
```

If `captureVerified` is `false` or absent, this client is not capturing. Either commit from a
client that runs hooks, or record edits yourself, once per file:

```bash
printf '{"tool_name":"fs_write","tool_input":{"path":"src/thing.ts"}}' \
  | bash scripts/hooks/log-ai-edit.sh
```

Manually logged edits satisfy the gate too. Paths must be repo-root-relative and match
`git diff --cached --name-only` exactly, or `pre-commit` files them under `human_files`.

## Prerequisites

- Node.js 20+ (for the CLI)
- git
- jq (for the hook scripts)
- Kiro, in a client that runs `.kiro/hooks/` (the IDE does; ACP-based clients may not —
  see [Verifying capture](#verifying-capture-before-you-trust-the-numbers))

## Troubleshooting

### Trailers show `ai-attribution: unknown`

Working as intended. It means capture could not be verified and nothing was logged, so the
commit's authorship is genuinely not known. The commit is excluded from the metrics rather
than being counted as human-authored.

To fix the underlying cause, see
[`.kiro-attribution.json` stays empty](#kiro-attributionjson-stays-empty-during-a-kiro-session).

Note that commits made before this check existed carry `ai-authorship: human-only` from the
old behaviour, and some of those may in fact have been agent-authored. There is no way to
recover that retroactively.

### Trailers show `human-only` with `ai-lines: 0` and `human-lines: 0`

Both counts being zero means `pre-commit` produced no line counts at all. A missing
`.kiro-attribution.json` now yields `ai-attribution: unknown` instead, so if you are seeing
`human-only` with two zeros you are either on an older version of the scripts or nothing was
staged. Otherwise this is almost always a working-directory problem: the hooks resolve the
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

First separate "the hook never ran" from "the hook ran but captured nothing" — they look
identical from the outside and have different fixes:

```bash
jq -c '.session' .kiro-attribution.json
```

- **No `session` key.** The `SessionStart` hook did not run, so the client is probably not
  loading `.kiro/hooks/` at all. Hooks are registered by the client, not by this repo — the
  Kiro IDE runs them; some other clients (ACP-based ones, for example) do not. Confirm the
  hooks appear in the IDE's Agent Hooks panel. Then isolate script from wiring:

  ```bash
  bash scripts/hooks/mark-session-start.sh && jq -c '.session' .kiro-attribution.json
  ```

  If that populates the marker, the scripts are fine and the client is not running them.

- **`captureVerified: false`.** Hooks run, but `log-ai-edit.sh` could not find a file path in
  the payload. This means the payload shape differs from what the script expects. Check what
  your client actually sends and compare against the extraction in `log-ai-edit.sh`; it
  accepts both `tool_name`/`tool_input` and `toolName`/`toolInput`, and reads `path`,
  `destinationPath`, then `targetFile`. The script warns on stderr when it hits this.

Also confirm `.kiro/hooks/track-ai-edits.json` exists, has `"enabled": true`, and that its
`matcher` covers the write tools your agent uses
(`fs_write|str_replace|fs_append|smart_relocate|semantic_rename`).

The hooks only fire on agent edits — files you edit by hand are correctly counted as human
lines.

### Working tree goes dirty immediately after every commit

You're tracking the ephemeral files. See the untracking steps in [Quick start](#make-your-project-trackable-write-side).

## Development

```bash
npm run test         # Run tests (39 passing)
npm run lint         # Run ESLint
npm run build        # Compile TypeScript
npm run metrics      # Run the CLI
```

## The contract: `metrics/attribution-log.jsonl`

The read side never queries a git-host API. Instead, CI rebuilds a standard artifact and
commits it to the repo, and the CLI reads that file. Because the tool only ever reads a
file — a local path or a raw URL — GitHub, GitLab, and self-hosted GitLab all work with the
same code and no host-specific configuration.

### Schema (one JSON object per line, chronological)

```json
{
  "sha": "abc123",
  "author": "Roger",
  "email": "roger@example.com",
  "date": "2026-08-04T15:20:54-04:00",
  "message": "feat: add metrics reader pipeline",
  "trailers": {
    "ai_authored_by": "kiro",
    "ai_authorship": "assisted",
    "ai_attribution": null,
    "ai_lines": 2781,
    "human_lines": 3775
  },
  "notes": {
    "ai_lines": 2781, "human_lines": 3775, "total_lines": 6556,
    "ai_files": ["src/..."], "human_files": ["README.md"]
  }
}
```

`notes` is `null` when git notes were unavailable at generation time (the log still works,
just without the file-level breakdown). A malformed line is skipped with a warning rather
than aborting the report.

### Generating the log

The single generator, `scripts/backfill-attribution-log.sh`, rebuilds the log from full
history. It is idempotent and self-healing — entries written before the notes ref was pushed
pick up their file-level data on the next run. Both CI pipelines call this same script, so CI
and local runs cannot drift.

Run it locally any time:
```bash
./scripts/backfill-attribution-log.sh
```

### Automating it with CI (pick your host)

Both templates call the shared script and emit the identical contract.

**GitHub** — copy `.github/workflows/attribution-log.yml`. GitHub does not retrigger a
workflow from a push made with the default token, so no loop guard is needed.

**GitLab (incl. gitlab.aws.dev)** — copy `.gitlab-ci.yml`. It needs an `ATTRIBUTION_PUSH_TOKEN`
CI/CD variable (a project access token with `write_repository`), because `CI_JOB_TOKEN`
cannot push to its own repo. Loop prevention is built in (`[skip ci]`, `--push-option=ci.skip`,
and a `workflow:` rule). If the token is absent the job still runs and reports what it would
change, but never fails the pipeline — attribution is observability, not a merge gate.

Either way, push your notes ref so CI can read the file-level data:
```bash
git push origin refs/notes/ai-attribution
```

### How the CLI consumes it

`--repo` accepts:
- a **local path** — a repo directory (looks for `metrics/attribution-log.jsonl` inside it) or a direct path to the file
- a **raw URL** — the file served by any host (GitHub raw, GitLab raw, gitlab.aws.dev raw)

For a private repo, export `METRICS_TOKEN` and it's sent as a `Bearer` header.

### Pushing git notes

Git notes live in a separate ref and aren't pushed by default:

```bash
git push origin refs/notes/ai-attribution
```

The explicit push is the recommended form, because it changes no configuration.

To make it automatic you must add **two** refspecs, not one:
```bash
git config --add remote.origin.push HEAD
git config --add remote.origin.push refs/notes/ai-attribution
```

Adding only the notes refspec is a trap. Setting `remote.origin.push` at all *replaces* the
default push behaviour rather than adding to it, so with just that one line a bare `git push`
pushes the notes ref and silently leaves your branch behind — local `main` advances while the
remote stays put, and the push reports success. The `HEAD` refspec restores normal
current-branch pushing alongside the notes.

Verify immediately after setting it:
```bash
git push --dry-run    # must list your branch, not just refs/notes/ai-attribution
```

Once the CI job starts appending notes of its own, a plain notes push can be rejected as
non-fast-forward. Resolve by merging, never with `--force`:
```bash
git fetch origin refs/notes/ai-attribution:refs/notes/ai-attribution
git notes --ref=ai-attribution merge -s cat_sort_uniq
```

## Design decisions

See [ADR-001: AI Code Attribution](docs/decisions/001-ai-code-attribution.md) for why we chose PostToolUse over other approaches.

## Related

- [sample-kiro-coding-metrics-collector](https://github.com/aws-samples/sample-kiro-coding-metrics-collector) — AWS sample for production-grade line-level attribution
- [AWS Kiro](https://kiro.dev)

## License

MIT-0
