# ADR-002: Attribution Across Submodule Boundaries

**Status:** Proposed — not yet implemented
**Date:** 2026-09-08
**Deciders:** roficas
**Supersedes:** nothing. Extends ADR-001.

## Context

ADR-001 established capture-at-edit-time attribution, and it works when the Kiro
workspace and the git repository share a root. They do not share a root when the code
being edited lives in a submodule, which is exactly the layout of this project: the
workspace root is `devs-with-genai/`, and `kiro-metrics-demo/` is a submodule tracking
`roficas/kiro-metrics`.

The two halves of the pipeline resolve their paths from different places.

`log-ai-edit.sh` runs from Kiro's working directory, which is the workspace root, so
`git rev-parse --show-toplevel` returns the **superproject**. Edits are logged there,
with a submodule-prefixed path:

```
/Users/roficas/Projects/devs-with-genai/.kiro-attribution.json
  → { "file": "kiro-metrics-demo/README.md", ... }
```

`pre-commit` runs from the repository being committed. Inside the submodule, the same
`git rev-parse --show-toplevel` returns the **submodule**, so it looks for a tracking
file that does not exist, and the staged paths it compares against have no prefix:

```
looks for: kiro-metrics-demo/.kiro-attribution.json   (absent)
staged as: README.md                                   (not kiro-metrics-demo/README.md)
```

Two independent failures, either of which is sufficient to lose the data: wrong file
location, and a prefix mismatch on an exact string comparison.

### Observed impact

Commit `6163e6f` in this repository contains agent-authored hook fixes and carries no
attribution at all. A subsequent dry run over 423 lines of agent-written HTML formatter
work produced:

```json
{"attribution_state": "unknown", "ai_lines": 0, "human_lines": 0, "total_lines": 0}
```

`unknown` is the correct and honest output given the inputs — the capture-verification
logic is working as designed, refusing to assert `human-only` when it cannot tell. But
the underlying data was available the whole time, one directory up. No agent work
committed from inside a submodule can currently be attributed.

## Decision

Teach `pre-commit` to look up into the superproject and normalise the prefix.

Git exposes the relationship directly:

```bash
SUPER=$(git rev-parse --show-superproject-working-tree)   # empty unless in a submodule
```

Proposed logic, applied only when no local tracking file is found:

1. If `$SUPER` is empty, behave exactly as today. Non-submodule repositories are
   unaffected.
2. If `$SUPER` is set and `$SUPER/.kiro-attribution.json` exists, read the log from
   there.
3. Derive the submodule's path relative to the superproject, and prepend it to each
   staged path before the comparison:

   ```bash
   PREFIX=${PWD#"$SUPER"/}          # e.g. "kiro-metrics-demo"
   LOOKUP="${PREFIX}/${file}"       # e.g. "kiro-metrics-demo/README.md"
   ```

4. Write the summary and the git note into the submodule, not the superproject. The
   attribution belongs to the commit being made.

`post-commit` must not reset the superproject's log when committing a submodule. The
same edits may still be pending for a superproject commit, and clearing them early
would recreate the silent-loss bug across the boundary. Reset only the log that was
actually consumed, which means `post-commit` needs the same superproject awareness.

## Consequences

### Positive
- Agent work committed inside a submodule becomes attributable
- Non-submodule repositories see no behaviour change; the lookup is a fallback
- Uses a documented git primitive rather than inferring paths from string shapes

### Negative
- `pre-commit` gains knowledge of superprojects, which is conceptual scope it did not
  previously have
- One tracking log now feeds two repositories, so reset timing becomes a correctness
  concern rather than housekeeping
- A single logical change spanning both repositories still requires two commits, and
  each will attribute only its own files. The totals will not sum to the change.

### Risks
- If both repositories are committed from the same pending log, whichever commits first
  determines what the second one sees. Reset ordering needs test coverage, not just
  reasoning.
- `--show-superproject-working-tree` returns empty for a plain nested repository that is
  not a registered submodule, so those remain unsupported. Acceptable: they are not a
  supported layout for this tool either way.

## Alternatives Considered

1. **Log to the nearest enclosing repository instead of the workspace root.** Would put
   the file where `pre-commit` already looks, requiring no `pre-commit` change. Rejected
   because `log-ai-edit.sh` would need to resolve the owning repository per edit, and a
   single agent turn routinely touches both repositories — producing two logs with
   split state and no clear reset point.

2. **Match on basename or suffix rather than full path.** A one-line change. Rejected:
   `README.md` exists in both repositories, and collapsing paths would attribute the
   wrong file. Precision is the entire premise of ADR-001.

3. **Accept the limitation and document it.** Viable while the submodule holds only
   tooling. Rejected because the submodule holds the CLI itself, which is where most
   agent work in this project actually lands — the metric would systematically
   undercount its own source repository.

4. **Stop using a submodule.** Removes the problem but loses the separately publishable
   `roficas/kiro-metrics` repository, which is a product requirement.

## Implementation Notes

Test coverage should include, at minimum:

- a submodule commit where the log lives in the superproject, expecting correct
  AI/human split rather than `unknown`
- a non-submodule repository, expecting byte-identical behaviour to today
- a superproject commit following a submodule commit, confirming pending edits for the
  superproject survived the submodule's reset
- a submodule with no superproject log, still expecting `unknown` rather than a
  fabricated `human-only`
