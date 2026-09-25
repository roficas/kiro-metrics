# kiro-metrics

A CLI tool that reads AI code attribution data from git repositories and produces metrics reports. It tells you what percentage of your code was written by AI, broken down by commit, file, author, and week.

Companion code for the blog post **"Metrics your board will trust: measuring agentic coding for engineering leaders."**

## What it does

Two parts:

1. **Write side** — a Kiro hook + git hooks that automatically tag every commit with AI attribution data. No changes to your source files. Everything lives in commit messages and git notes.
2. **The contract** — CI (GitHub Actions *or* GitLab CI) rebuilds a standard artifact, `metrics/attribution-log.jsonl`, and commits it to the repo. This is the boundary between the two sides.
3. **Read side** — a CLI that reads that artifact and computes metrics. It never talks to a git-host API and never touches git, so GitHub, GitLab, and self-hosted GitLab all work identically.

## What gets captured (in plain terms)

For every commit, the tool records **who wrote the lines** — the AI agent or a human — and how many of each. It does this by watching which files the agent edits during a Kiro session, then stamping the counts onto the commit. Nothing about your source code is read or stored; only line counts and file names.

Two headline numbers come out of this:

- **Involvement rate** — of all commits, what share had *any* AI help. Answers "how often is AI in the loop?"
- **Authorship rate** — of all lines written, what share the AI wrote. Answers "how much of the code is AI's?"

### How common scenarios show up

| Scenario | Commit is tagged | Involvement | Authorship |
|---|---|---|---|
| Agent writes a whole file, you commit it as-is | `generated` | counts as AI-involved | 100% AI for those lines |
| Agent drafts code, you hand-edit some lines, then commit | `assisted` | counts as AI-involved | split — e.g. 70% AI / 30% human |
| You write everything yourself, no agent | `human-only` | not AI-involved | 0% AI for those lines |
| A CI bot commits (e.g. the attribution log update) | detected as bot | **excluded** from both rates | excluded |
| Agent edited files but capture couldn't be verified | `unknown` | **excluded** (not counted as human) | excluded |

The last two rows are the important ones for trust: **bot commits and unverifiable commits are left out of the rates entirely**, rather than being silently miscounted as human work. That keeps the numbers honest — the tool would rather report "don't know" than inflate the human share.

### What is *not* captured

- Your actual source code — only line counts and file paths.
- Files you edit by hand outside a Kiro session — correctly counted as human.
- Generated files (lockfiles, build output) — excluded so they don't dilute the rate.

## Quick start

### Make your project trackable (write side)

Copy one Kiro hook file and the `scripts/hooks/` folder, then run one command. Nothing else
changes in your project. Run these from your clone of this repository:

```bash
TARGET=/path/to/your-project

# 1. Copy the Kiro agent hooks (capture probe + edit logger)
mkdir -p "$TARGET/.kiro/hooks"
cp .kiro/hooks/track-ai-edits.json "$TARGET/.kiro/hooks/"

# 2. Copy the hook scripts (includes install-hooks.sh and lib-generated.sh,
#    which pre-commit sources to exclude lockfiles and build output)
mkdir -p "$TARGET/scripts/hooks"
cp scripts/hooks/* "$TARGET/scripts/hooks/"
chmod +x "$TARGET/scripts/hooks/"*

# 3. Install the git hooks (symlinks them into .git/hooks/)
cd "$TARGET"
./scripts/hooks/install-hooks.sh

# 4. Add tracking files to .gitignore — do this BEFORE your first commit
echo ".kiro-attribution.json" >> .gitignore
echo ".kiro-attribution-staged.json" >> .gitignore
```

That's it. Start a new Kiro session and every commit will be automatically tagged.

> **What runs automatically.** Once `.kiro/hooks/track-ai-edits.json` is in a workspace
> Kiro trusts, Kiro runs `scripts/hooks/mark-session-start.sh` when a session starts and
> `scripts/hooks/log-ai-edit.sh` after each agent file edit. The git hooks run on every
> commit. All of them only read git state and write the two local tracking files below;
> none make network calls. Read them before installing, as you would any hook.

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
npx tsx src/index.ts --repo https://gitlab.example.com/group/proj/-/raw/main/metrics/attribution-log.jsonl

# Private repo? Export a token (host-agnostic, sent as a Bearer header — https only)
export METRICS_TOKEN=<token>
npx tsx src/index.ts --repo https://gitlab.example.com/group/proj/-/raw/main/metrics/attribution-log.jsonl
```

Give `METRICS_TOKEN` read-only scope (`read_repository` on GitLab, `contents: read` on
GitHub) and an expiry. The CLI refuses to send it over plain `http://`, times out after 30s,
and rejects logs above 50 MB.

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

The log carries **no email addresses by default**. It is committed to the repository and
reports built from it get forwarded, so it should not spread personal data further than git
history already does. Pass `--with-email` to the generator if you need it (an optional
`"email"` key is then added); `--author` will match on it and bot detection will use it.
Without it, `--author` matches on name only.

### Generating the log

The single generator, `scripts/backfill-attribution-log.sh`, rebuilds the log from full
history. It is idempotent and self-healing — entries written before the notes ref was pushed
pick up their file-level data on the next run. Both CI pipelines call this same script, so CI
and local runs cannot drift.

Run it locally any time:
```bash
./scripts/backfill-attribution-log.sh               # default: no email addresses
./scripts/backfill-attribution-log.sh --with-email  # opt in to recording author emails
```

### Automating it with CI (pick your host)

Both templates call the shared script and emit the identical contract.

**GitHub** — copy `.github/workflows/attribution-log.yml`. GitHub does not retrigger a
workflow from a push made with the default token, so no loop guard is needed.

**GitLab (gitlab.com or self-hosted)** — copy `.gitlab-ci.yml`. It needs an `ATTRIBUTION_PUSH_TOKEN`
CI/CD variable because `CI_JOB_TOKEN` cannot push to its own repo. Create it with the least
access that works and treat it as a secret:

- a **project** access token (not personal), role **Developer**, scope **`write_repository`** only, with an expiry
- stored as a CI/CD variable marked **Masked** and **Protected**, so it never appears in job logs and is only exposed to protected branches
- if your default branch is protected, allow that token's role to push to it (Settings > Repository > Protected branches)

The job passes the token through a git credential helper, never in a URL, so a failed push
cannot echo it into the log. Loop prevention is built in (`[skip ci]`, `--push-option=ci.skip`,
and a `workflow:` rule). If the token is absent the job still runs and reports what it would
change, but never fails the pipeline — attribution is observability, not a merge gate.

Either way, push your notes ref so CI can read the file-level data:
```bash
git push origin refs/notes/ai-attribution
```

### How the CLI consumes it

`--repo` accepts:
- a **local path** — a repo directory (looks for `metrics/attribution-log.jsonl` inside it) or a direct path to the file
- a **raw URL** — the file served by any host (GitHub raw, GitLab raw, self-hosted GitLab raw)

For a private repo, export `METRICS_TOKEN` and it's sent as a `Bearer` header over `https://` only.

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
