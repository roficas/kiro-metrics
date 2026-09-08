#!/usr/bin/env bash
# install-hooks.sh — Symlinks the git hooks into .git/hooks/
# Run from the project root: ./scripts/hooks/install-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_HOOKS_DIR="$(git rev-parse --show-toplevel)/.git/hooks"

# jq is a hard requirement — every hook script parses JSON with it. Without jq the
# hooks fail open and attribution silently stops, so fail loudly here instead.
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is not on PATH. All attribution hooks depend on it." >&2
  echo "  macOS: brew install jq     Amazon Linux: sudo yum install -y jq" >&2
  exit 1
fi

# The pre-commit framework also wants to own these hook files. If it got there first,
# overwriting its shim would disable whatever it runs (gitleaks, linters). Refuse
# rather than silently break someone's security tooling.
for hook in pre-commit prepare-commit-msg post-commit; do
  target="$GIT_HOOKS_DIR/$hook"
  if [ -f "$target" ] && [ ! -L "$target" ] && grep -q "pre-commit" "$target" 2>/dev/null; then
    echo "ERROR: $target looks like a pre-commit framework hook." >&2
    echo "  Overwriting it would disable whatever the framework runs there." >&2
    echo "  Register these scripts as 'local' hooks in .pre-commit-config.yaml instead." >&2
    exit 1
  fi
  if [ -f "${target}.legacy" ]; then
    echo "WARNING: ${target}.legacy exists — the pre-commit framework displaced a hook here."
    echo "  'pre-commit install -f' deletes .legacy files, which would silently kill"
    echo "  attribution. Prefer explicit 'local' hooks over relying on the legacy chain."
  fi
done

for hook in pre-commit prepare-commit-msg post-commit; do
  ln -sf "$SCRIPT_DIR/$hook" "$GIT_HOOKS_DIR/$hook"
  echo "Installed: $hook -> $GIT_HOOKS_DIR/$hook"
done

# A core.hooksPath override means git ignores .git/hooks entirely, so the symlinks
# above never run unless the configured wrapper explicitly chains to them.
HOOKS_PATH="$(git config core.hooksPath || true)"
if [ -n "$HOOKS_PATH" ]; then
  echo
  echo "NOTE: core.hooksPath is set to '$HOOKS_PATH'."
  echo "git runs hooks from there, not from .git/hooks. Many corporate wrappers"
  echo "(git-defender, for example) run their own checks and then chain to the repo-local"
  echo "hooks, in which case these symlinks DO fire and this note is a false positive."
  echo "Confirm either way by making a real commit and checking for trailers:"
  echo "  git log -1 --format='%B' | grep '^ai-'"
  echo "If the wrapper does not chain, the symptom is every commit reading"
  echo "'ai-attribution: unknown'."
fi

echo "Done. AI attribution hooks are active."
