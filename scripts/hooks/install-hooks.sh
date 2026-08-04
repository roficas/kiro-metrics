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

echo "Done. AI attribution hooks are active."
