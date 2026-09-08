#!/usr/bin/env bash
# report.sh — One-command wrapper around the kiro-metrics CLI.
#
# The raw invocation needs --repo, --view, --format and --since every time, which is
# tedious and led to reports being written to whatever directory happened to be handy.
# This wrapper supplies the defaults that are almost always right: the current git
# repository, a 90-day window, and metrics/reports/ as the destination.
#
# Usage:
#   ./scripts/report.sh                    # team view, terminal, to stdout
#   ./scripts/report.sh board              # board view
#   ./scripts/report.sh developer "Roger"  # one contributor
#   ./scripts/report.sh all                # every view x format, written to metrics/reports/
#   ./scripts/report.sh board --format md --out
#
# Any flag after the view (and author, for developer) is passed through untouched, so
# --since, --hourly-rate, --include-bots and --out all work as documented.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

VIEW="${1:-team}"
shift || true

# `developer` is the only view that needs an author, and requiring the --author flag for
# it defeats the point of a shortcut. Accept a bare name, but only when the next argument
# is not itself a flag.
AUTHOR_ARGS=()
if [ "$VIEW" = "developer" ] && [ $# -gt 0 ] && [[ "$1" != -* ]]; then
  AUTHOR_ARGS=(--author "$1")
  shift
fi

# Resolve the CLI. Order matters: an installed binary wins, then a local node_modules
# bin, then the TypeScript sources in a sibling checkout or submodule. Without this the
# script would only work from inside the tool's own repository.
if command -v kiro-metrics >/dev/null 2>&1; then
  RUN=(kiro-metrics)
elif [ -x "${REPO_ROOT}/node_modules/.bin/kiro-metrics" ]; then
  RUN=("${REPO_ROOT}/node_modules/.bin/kiro-metrics")
elif [ -f "${REPO_ROOT}/src/index.ts" ]; then
  RUN=(npx --prefix "$REPO_ROOT" tsx "${REPO_ROOT}/src/index.ts")
elif [ -f "${REPO_ROOT}/kiro-metrics-demo/src/index.ts" ]; then
  RUN=(npx --prefix "${REPO_ROOT}/kiro-metrics-demo" tsx "${REPO_ROOT}/kiro-metrics-demo/src/index.ts")
else
  echo "Cannot find the kiro-metrics CLI." >&2
  echo "  Install it (npm install -g @roficas/kiro-metrics), or run this from a" >&2
  echo "  checkout that has src/index.ts or kiro-metrics-demo/src/index.ts." >&2
  exit 1
fi

# macOS ships bash 3.2, where expanding an empty array under `set -u` is an unbound
# variable error rather than an empty list. The ${arr[@]+"${arr[@]}"} guard expands to
# nothing when the array is empty and to its elements otherwise, on both 3.2 and 5.x.
run_one() {
  local view="$1"
  shift
  "${RUN[@]}" --repo "$REPO_ROOT" --view "$view" --since 90d ${@+"$@"}
}

if [ "$VIEW" = "all" ]; then
  # Author is required for the developer view, so derive the top contributor rather than
  # failing. Falls back to skipping that view if the log has no attributed commits yet.
  TOP_AUTHOR=$("${RUN[@]}" --repo "$REPO_ROOT" --view team --since 90d --format json 2>/dev/null \
    | jq -r '.byAuthor[0].author // empty' || true)

  for v in team board developer; do
    if [ "$v" = "developer" ]; then
      if [ -z "$TOP_AUTHOR" ]; then
        echo "  skipping developer view: no attributed commits to pick an author from" >&2
        continue
      fi
      EXTRA=(--author "$TOP_AUTHOR")
    else
      EXTRA=()
    fi
    for f in terminal md html json; do
      run_one "$v" ${EXTRA[@]+"${EXTRA[@]}"} --format "$f" --out
    done
  done
  echo "  All reports in ${REPO_ROOT}/metrics/reports/" >&2
  exit 0
fi

run_one "$VIEW" ${AUTHOR_ARGS[@]+"${AUTHOR_ARGS[@]}"} ${@+"$@"}
