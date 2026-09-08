#!/usr/bin/env bash
# lib-generated.sh — the single definition of "this file was produced by a tool".
#
# Sourced by pre-commit (to classify staged files) and by reclassify-notes.sh (to correct
# historical notes). It exists as a library because the list had already been copied once,
# and a divergence between the two would mean historical corrections silently disagreeing
# with live measurement — the kind of drift that is invisible until the numbers are wrong.
#
# Generated content belongs to neither author, so it is excluded from both buckets rather
# than defaulting to human. Counting npm's lockfile as hand-written understated AI
# authorship by 37 percentage points in this repository's own history.

# Usage: is_generated "<repo-relative path>"  -> 0 if generated, 1 otherwise.
# Patterns are matched against the repo-relative path git reports, so directory entries
# need the `*` prefix to match at any depth.
is_generated() {
  case "$1" in
    # Attribution tracking scratch files — counting these lets the tracker inflate its
    # own human numbers.
    .kiro-attribution.json|.kiro-attribution-staged.json|*/.kiro-attribution.json|*/.kiro-attribution-staged.json) return 0 ;;
    # Dependency lock files
    *package-lock.json|*npm-shrinkwrap.json|*yarn.lock|*pnpm-lock.yaml|*bun.lockb) return 0 ;;
    *Cargo.lock|*poetry.lock|*Pipfile.lock|*uv.lock|*composer.lock|*Gemfile.lock|*go.sum) return 0 ;;
    # Vendored dependencies and build output
    node_modules/*|*/node_modules/*|vendor/*|*/vendor/*) return 0 ;;
    dist/*|*/dist/*|build/*|*/build/*|out/*|*/out/*|target/*|*/target/*) return 0 ;;
    .next/*|*/.next/*|coverage/*|*/coverage/*) return 0 ;;
    # Generated report output
    metrics/reports/*|*/metrics/reports/*) return 0 ;;
    # Minified bundles, source maps, and conventional codegen output
    *.min.js|*.min.css|*.map) return 0 ;;
    *.generated.*|*_pb2.py|*_pb2_grpc.py|*.pb.go|*.g.dart) return 0 ;;
  esac
  return 1
}

# Resolve the directory holding these hook scripts, following symlinks.
# install-hooks.sh symlinks the hooks into .git/hooks/, so $0 and BASH_SOURCE point at the
# symlink; a naive dirname yields .git/hooks/ and the source below would fail.
resolve_hook_dir() {
  local src="$1" dir
  while [ -L "$src" ]; do
    dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    case "$src" in /*) ;; *) src="$dir/$src" ;; esac
  done
  cd -P "$(dirname "$src")" && pwd
}
