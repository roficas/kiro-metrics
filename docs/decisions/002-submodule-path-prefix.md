# ADR-002: Attribution Across Repository Boundaries

**Status:** Accepted
**Date:** 2026-09-08
**Deciders:** roficas
**Extends:** ADR-001

> Revised after implementation. The first draft proposed teaching `pre-commit` to look up
> into the superproject and strip a submodule prefix. That was the wrong layer. See
> *Alternatives Considered* for why the rejected option turned out to be the right one.

## Context

ADR-001 captures attribution at edit time. It works when the Kiro workspace and the git
repository share a root. They do not when a workspace spans more than one repository, and
this project spans two: the workspace root `devs-with-genai/`, and the submodule
`kiro-metrics-demo/` tracking `roficas/kiro-metrics`.

`pre-commit` matches staged files against the tracking log with an **exact string
comparison** against `git diff --cached --name-only`, which is repo-root-relative. Two
things must therefore be true: the log must live where the committing repository looks for
it, and its paths must be relative to that repository.

Deriving a single root from the hook's working directory satisfied neither.

`log-ai-edit.sh` resolved `git rev-parse --show-toplevel` from Kiro's working directory —
the superproject. So an edit to the submodule's README was written as:

```
devs-with-genai/.kiro-attribution.json
  → { "file": "kiro-metrics-demo/README.md" }
```

while the submodule's `pre-commit` looked for `kiro-metrics-demo/.kiro-attribution.json`
(absent) and compared against `README.md`. Wrong file, wrong path.

Sibling checkouts failed harder. An absolute path outside the workspace root hit an
explicit "outside the repo" guard and was discarded, so a multi-root workspace lost
attribution for every repository but the first.

### Observed impact

Commit `6163e6f` carries agent-authored hook fixes and no attribution. A dry run over 423
lines of agent-written HTML formatter work reported:

```json
{"attribution_state": "unknown", "ai_lines": 0, "human_lines": 0, "total_lines": 0}
```

`unknown` was the honest output for the inputs available, but the data existed one
directory up the whole time.

Worse, a commit with no trailers at all is not recorded as human either. The engine needs
both `aiLines` and `humanLines` defined before counting a commit, so such commits
contribute `0/0`. In this repository **15 of 22 counted commits** contributed nothing to
the authorship denominator. A single hand-edited README line was invisible rather than
counted as human work.

## Decision

Resolve the owning repository **per edited file**, in `log-ai-edit.sh`, and write into
that repository's log using a path relative to it.

```bash
OWNING_ROOT="$(git -C "$LOOKUP_DIR" rev-parse --show-toplevel)"
FILE_PATH="${ABS_PATH#"$OWNING_ROOT"/}"
TRACKING_PATH="${OWNING_ROOT}/.kiro-attribution.json"
```

`pre-commit` needs no change. It already reads its own repository's log and compares
repo-relative paths; it was simply never given correct input.

Three details the implementation must get right:

1. **Non-existent files.** A create fires `PostToolUse` before the file exists, so the
   lookup walks up to the nearest existing directory, accumulating the remainder to
   rebuild the path afterwards.
2. **Symlinked paths.** `rev-parse --show-toplevel` always reports the physical path. On
   macOS `/var` is a symlink to `/private/var`, so comparing a logical incoming path
   against it fails the prefix test and silently drops the edit. Canonicalise with
   `pwd -P` first — not `realpath --relative-to`, which is a GNU-only flag absent on BSD.
3. **Files in no repository.** Nothing will ever commit them, so exit without logging.

Each repository owning its own log also fixes a latent hazard: `post-commit` resets the
log it consumed. With one shared log, whichever repository committed first would discard
edits still pending for the other.

## Consequences

### Positive
- Agent work committed inside a submodule is attributable
- Sibling and multi-root layouts work, where they previously lost data outright
- Plain nested repositories work too, which the superproject approach could not handle:
  `--show-superproject-working-tree` returns empty for anything not a registered submodule
- Reset semantics become per-repository and therefore correct by construction
- No change to `pre-commit`, `prepare-commit-msg` or `post-commit`

### Negative
- One `git rev-parse` per edit. Negligible, but no longer zero.
- A logical change spanning two repositories still needs two commits, each attributing
  only its own files. The totals will not sum to the change.
- Every participating repository must gitignore the two tracking files, not just the
  workspace root.

### Risks
- Only the owning repository is consulted, so a file that is somehow tracked by two
  repositories is attributed to the innermost. Acceptable: that is also the one that will
  commit it.
- Attribution remains file-level per ADR-001. A file touched by both a human and the
  agent before a commit still counts entirely as AI.

## Alternatives Considered

1. **Teach `pre-commit` to read the superproject's log and strip the prefix.** The first
   draft's decision, via `git rev-parse --show-superproject-working-tree`. Rejected on
   implementation: it is more code, submodule-only, leaves the shared-log reset hazard in
   place, and does nothing for sibling or nested layouts. The original draft dismissed
   per-file resolution on the grounds that two logs meant "split state with no clear reset
   point." That was backwards — two logs is precisely what makes the reset well-defined.

2. **Restructure to sibling repositories and drop the submodule.** Tested before
   deciding: the "outside the repo" guard discarded the edit entirely, producing no log at
   all. Strictly worse than a prefix mismatch, where the data at least exists.

3. **Match on basename or path suffix.** A one-line change. Rejected: `README.md` exists
   in both repositories, so this attributes the wrong file. Precision is the premise of
   ADR-001.

4. **Accept the limitation.** Rejected. The submodule holds the CLI itself, which is where
   most agent work in this project lands, so the metric would systematically undercount
   its own source repository.

## Validation

Six scenarios, all passing:

| Scenario | Expected | Result |
|---|---|---|
| Edit in superproject, cwd superproject | `super/` log, `docs/doc.md` | pass |
| Edit in submodule, cwd superproject | `sub/` log, `src/a.ts` | pass |
| Edit in sibling repo, absolute path | `sibling/` log, `lib/b.ts` | pass |
| New file, nested dirs absent | `src/brand/new/deep.ts` | pass |
| File in no repository | no log written | pass |
| End-to-end submodule commit | `ai-lines: 20`, `human-lines: 6` | pass |

The last case is the one that matters: an agent-written file and a hand-written file
staged together in a submodule now produce `ai-authorship: assisted` with a note naming
`src/agent.ts` as AI and `README.md` as human. Previously the same commit produced
`attribution_state: unknown`.
