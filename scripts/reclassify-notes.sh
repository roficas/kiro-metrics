#!/usr/bin/env bash
# reclassify-notes.sh — Retroactively remove tool-generated files from attribution notes.
#
# Notes written before is_generated() existed counted lockfiles, build output and the
# tracker's own scratch files as human-authored. In this repository a single
# package-lock.json contributed 3745 of 4569 recorded human lines, dragging the authorship
# rate from 84.5% down to 47.5%.
#
# Commit trailers are immutable without rewriting history, which is not worth doing for a
# metric. Git notes are mutable, and the consolidation engine prefers notes over trailers,
# so correcting the notes corrects the reports while leaving history untouched. Trailers
# will afterwards disagree with notes on affected commits; that is the intended trade and
# is recorded here rather than hidden.
#
# Method: SUBTRACTIVE, deliberately.
#   For each generated file named in a note, subtract that file's added lines (from the
#   commit's own diff) from the recorded total, and move it into excluded_files.
#   Everything else is left exactly as measured at commit time.
#
# It does NOT recompute totals from scratch. A note records the STAGED diff at pre-commit
# time, which legitimately differs from the commit's final diff when more content is staged
# afterwards. Recomputing conflates "remove generated files" with "re-measure everything",
# and on this repository the latter inflated one commit's AI lines by 227 — the flattering
# direction, which is exactly the direction an attribution tool must not drift in.
#
# Usage:
#   ./scripts/reclassify-notes.sh              # dry run, prints the diff it would make
#   ./scripts/reclassify-notes.sh --apply      # rewrite notes, after backing up the ref
#   ./scripts/reclassify-notes.sh --repo PATH  # operate on another checkout

set -euo pipefail

REPO=""
APPLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --repo)  REPO="${2:?--repo needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
[ -n "$REPO" ] && cd "$REPO"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${SCRIPT_DIR}/hooks/lib-generated.sh"
if [ ! -f "$LIB" ]; then
  echo "Cannot find ${LIB}. It defines which files count as generated." >&2
  exit 1
fi
# shellcheck source=hooks/lib-generated.sh
. "$LIB"

git rev-parse --verify --quiet refs/notes/ai-attribution >/dev/null 2>&1 || {
  echo "No refs/notes/ai-attribution in this repository — nothing to reclassify." >&2
  exit 0
}

# Added lines for one path in one commit, straight from that commit's diff.
added_for() {
  git show --numstat --format='' "$1" 2>/dev/null \
    | awk -v f="$2" '$3==f {print ($1=="-"?0:$1); found=1} END {if(!found) print 0}' | head -1
}

if [ "$APPLY" = true ]; then
  BACKUP="refs/notes/ai-attribution-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  git update-ref "$BACKUP" refs/notes/ai-attribution
  echo "  Backed up notes ref to ${BACKUP}" >&2
  echo "  Restore with: git update-ref refs/notes/ai-attribution ${BACKUP}" >&2
  echo >&2
fi

CHANGED=0
TOTAL_EXCLUDED=0

while read -r sha; do
  note=$(git notes --ref=ai-attribution show "$sha" 2>/dev/null || true)
  [ -n "$note" ] || continue
  printf '%s' "$note" | jq -e . >/dev/null 2>&1 || {
    echo "  skipping $(git rev-parse --short "$sha"): note is not valid JSON" >&2
    continue
  }

  ai=$(printf '%s' "$note" | jq -r '.ai_lines // 0')
  human=$(printf '%s' "$note" | jq -r '.human_lines // 0')
  excluded=$(printf '%s' "$note" | jq -r '.excluded_lines // 0')

  gen_ai=(); gen_human=(); removed=0

  while read -r f; do
    [ -n "$f" ] || continue
    if is_generated "$f"; then
      n=$(added_for "$sha" "$f")
      ai=$((ai - n)); removed=$((removed + n)); gen_ai+=("$f")
    fi
  done < <(printf '%s' "$note" | jq -r '.ai_files[]? // empty')

  while read -r f; do
    [ -n "$f" ] || continue
    if is_generated "$f"; then
      n=$(added_for "$sha" "$f")
      human=$((human - n)); removed=$((removed + n)); gen_human+=("$f")
    fi
  done < <(printf '%s' "$note" | jq -r '.human_files[]? // empty')

  [ "$removed" -gt 0 ] || continue

  # A note can under-report relative to the commit's final diff, so subtraction can go
  # negative. Clamp, but announce it rather than emitting a nonsensical total.
  if [ "$ai" -lt 0 ]; then echo "  $(git rev-parse --short "$sha"): ai clamped ${ai} -> 0" >&2; ai=0; fi
  if [ "$human" -lt 0 ]; then echo "  $(git rev-parse --short "$sha"): human clamped ${human} -> 0" >&2; human=0; fi

  gen_json=$(printf '%s\n' ${gen_ai[@]+"${gen_ai[@]}"} ${gen_human[@]+"${gen_human[@]}"} \
    | grep -v '^$' | jq -R . | jq -s 'unique')

  new_note=$(printf '%s' "$note" | jq -c \
    --argjson ai "$ai" \
    --argjson human "$human" \
    --argjson excluded "$((excluded + removed))" \
    --argjson gen "$gen_json" \
    '
      .ai_lines = $ai
      | .human_lines = $human
      | .total_lines = ($ai + $human)
      | .excluded_lines = $excluded
      | .ai_files = [(.ai_files // [])[] | select(IN($gen[]) | not)]
      | .human_files = [(.human_files // [])[] | select(IN($gen[]) | not)]
      | .excluded_files = (((.excluded_files // []) + $gen) | unique)
      | .reclassified = true
    ')

  CHANGED=$((CHANGED + 1))
  TOTAL_EXCLUDED=$((TOTAL_EXCLUDED + removed))

  echo "  $(git rev-parse --short "$sha")  -${removed} generated lines  $(printf '%s' "$gen_json" | jq -rc .)"

  if [ "$APPLY" = true ]; then
    printf '%s' "$new_note" | git notes --ref=ai-attribution add -f -F - "$sha"
  fi
done < <(git notes --ref=ai-attribution list | awk '{print $2}')

echo
echo "  commits affected:        ${CHANGED}"
echo "  generated lines removed: ${TOTAL_EXCLUDED}"

if [ "$APPLY" = true ]; then
  echo
  echo "  Notes rewritten. Next steps:"
  echo "    ./scripts/backfill-attribution-log.sh     # regenerate the log from the new notes"
  echo "    git push origin refs/notes/ai-attribution # publish, so CI sees the corrections"
else
  echo
  echo "  Dry run. Re-run with --apply to rewrite the notes."
fi
