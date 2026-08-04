#!/usr/bin/env bash
# install-hooks.sh — Symlinks the git hooks into .git/hooks/
# Run from the project root: ./scripts/hooks/install-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_HOOKS_DIR="$(git rev-parse --show-toplevel)/.git/hooks"

for hook in pre-commit prepare-commit-msg post-commit; do
  ln -sf "$SCRIPT_DIR/$hook" "$GIT_HOOKS_DIR/$hook"
  echo "Installed: $hook -> $GIT_HOOKS_DIR/$hook"
done

# A core.hooksPath override means git ignores .git/hooks entirely, so the symlinks
# above never run unless the configured wrapper explicitly chains to them.
HOOKS_PATH="$(git config core.hooksPath || true)"
if [ -n "$HOOKS_PATH" ]; then
  echo
  echo "WARNING: core.hooksPath is set to '$HOOKS_PATH'."
  echo "git will run hooks from there, not from .git/hooks, so these symlinks may never fire."
  echo "Verify with: bash $SCRIPT_DIR/pre-commit && cat .kiro-attribution-staged.json"
fi

echo "Done. AI attribution hooks are active."
