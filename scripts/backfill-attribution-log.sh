#!/usr/bin/env bash
# backfill-attribution-log.sh — Rebuilds metrics/attribution-log.jsonl from full local history.
#
# The GitHub Action (.github/workflows/attribution-log.yml) is incremental: it walks
# LAST_LOGGED..HEAD and skips any SHA already present in the file. That means entries written
# before the refs/notes/ai-attribution ref was pushed keep `notes: null` forever — the Action
# will never revisit them. Since file-level attribution (ai_files/human_files) lives only in
# the notes, `byFile` and the report's top-AI-files sections stay empty. This script closes
# that gap by regenerating the whole log locally, where the notes ref is available.
#
# Emits exactly the schema the workflow emits, so the CLI's GitHub connector parses either
# interchangeably. Deliberately adds no fields the workflow lacks, to avoid drift between
# backfilled and incrementally-appended entries.
#
# Usage:
#   ./scripts/backfill-attribution-log.sh [--repo PATH] [--output FILE] [--dry-run] [--with-email]
#
#   --repo PATH     Repository to read history from (default: current repo)
#   --output FILE   Where to write (default: <repo>/metrics/attribution-log.jsonl)
#   --dry-run       Print to stdout and a summary to stderr; write nothing
#   --with-email    Record each author's email. Off by default: the log is committed to
#                   the repository and reports get forwarded, so it should not carry
#                   personal data unless you have decided it needs to. Without it,
#                   --author matches on name only and bot detection relies on the name.

set -euo pipefail

REPO=""
OUTPUT=""
DRY_RUN=false
WITH_EMAIL=false

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)       REPO="${2:?--repo needs a path}"; shift 2 ;;
    --output)     OUTPUT="${2:?--output needs a path}"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --with-email) WITH_EMAIL=true; shift ;;
    -h|--help)    sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

if [ -n "$REPO" ]; then
  cd "$REPO"
fi
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Not a git repository: ${REPO:-$PWD}" >&2; exit 1
}
cd "$REPO_ROOT"

if [ -z "$OUTPUT" ]; then
  OUTPUT="${REPO_ROOT}/metrics/attribution-log.jsonl"
fi

# Only meaningful if the notes ref exists; without it this reproduces the same
# `notes: null` entries the Action already wrote, which is a no-op worth flagging.
HAS_NOTES=false
if git rev-parse --verify --quiet refs/notes/ai-attribution >/dev/null 2>&1; then
  HAS_NOTES=true
else
  echo "[backfill] WARNING: refs/notes/ai-attribution does not exist in this repo." >&2
  echo "[backfill]          Every entry will have notes: null and no file-level data." >&2
fi

# Trailer values are interpolated into JSON as numbers, so a malformed trailer
# (empty, or non-numeric) must not produce invalid JSON.
numeric_or_zero() {
  case "$1" in
    ''|*[!0-9]*) echo 0 ;;
    *) echo "$1" ;;
  esac
}

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

TOTAL=0
WITH_NOTES=0
WITH_AI=0

while read -r SHA; do
  [ -n "$SHA" ] || continue
  TOTAL=$((TOTAL + 1))

  # %aN/%aE (capitalized), not %an/%ae: the capitalized forms are mailmap-aware, so a
  # repo's .mailmap collapses split identities (e.g. two emails for one person) into one
  # canonical name here. The lowercase forms ignore .mailmap entirely and would silently
  # keep reporting the same person as separate contributors.
  AUTHOR=$(git log -1 --format='%aN' "$SHA")
  EMAIL=""
  if [ "$WITH_EMAIL" = true ]; then
    EMAIL=$(git log -1 --format='%aE' "$SHA")
  fi
  DATE=$(git log -1 --format='%aI' "$SHA")
  MESSAGE=$(git log -1 --format='%s' "$SHA")
  FULL_MSG=$(git log -1 --format='%B' "$SHA")

  AI_AUTHORED_BY=$(printf '%s\n' "$FULL_MSG" | grep -m1 '^ai-authored-by:' | sed 's/^ai-authored-by:[[:space:]]*//' || true)
  AI_AUTHORSHIP=$(printf '%s\n' "$FULL_MSG" | grep -m1 '^ai-authorship:' | sed 's/^ai-authorship:[[:space:]]*//' || true)
  AI_LINES=$(printf '%s\n' "$FULL_MSG" | grep -m1 '^ai-lines:' | sed 's/^ai-lines:[[:space:]]*//' || true)
  HUMAN_LINES=$(printf '%s\n' "$FULL_MSG" | grep -m1 '^human-lines:' | sed 's/^human-lines:[[:space:]]*//' || true)
  # `ai-attribution: unknown` is written by prepare-commit-msg when capture could not be
  # verified. Without recording it, an unmeasurable commit is indistinguishable from a
  # genuinely human-only one — which silently defeats the point of reporting `unknown`
  # rather than guessing. Consumers need to exclude these from rates, not count them as human.
  AI_ATTRIBUTION=$(printf '%s\n' "$FULL_MSG" | grep -m1 '^ai-attribution:' | sed 's/^ai-attribution:[[:space:]]*//' || true)

  AI_LINES=$(numeric_or_zero "$AI_LINES")
  HUMAN_LINES=$(numeric_or_zero "$HUMAN_LINES")

  NOTES=null
  if [ "$HAS_NOTES" = true ]; then
    RAW_NOTE=$(git notes --ref=ai-attribution show "$SHA" 2>/dev/null || true)
    # A note can be non-JSON if `git notes append` concatenated two payloads.
    if [ -n "$RAW_NOTE" ] && printf '%s' "$RAW_NOTE" | jq -e . >/dev/null 2>&1; then
      NOTES=$(printf '%s' "$RAW_NOTE" | jq -c .)
      WITH_NOTES=$((WITH_NOTES + 1))
    elif [ -n "$RAW_NOTE" ]; then
      echo "[backfill] WARNING: note on ${SHA:0:8} is not valid JSON; recording null." >&2
    fi
  fi

  [ "$AI_LINES" -gt 0 ] && WITH_AI=$((WITH_AI + 1))

  jq -n -c \
    --arg sha "$SHA" \
    --arg author "$AUTHOR" \
    --arg email "$EMAIL" \
    --arg date "$DATE" \
    --arg message "$MESSAGE" \
    --arg ai_authored_by "$AI_AUTHORED_BY" \
    --arg ai_authorship "$AI_AUTHORSHIP" \
    --arg ai_attribution "$AI_ATTRIBUTION" \
    --argjson ai_lines "$AI_LINES" \
    --argjson human_lines "$HUMAN_LINES" \
    --argjson notes "$NOTES" \
    '{
      sha: $sha,
      author: $author,
      date: $date,
      message: $message,
      trailers: {
        ai_authored_by: (if $ai_authored_by == "" then null else $ai_authored_by end),
        ai_authorship: (if $ai_authorship == "" then null else $ai_authorship end),
        ai_attribution: (if $ai_attribution == "" then null else $ai_attribution end),
        ai_lines: $ai_lines,
        human_lines: $human_lines
      },
      notes: $notes
    }
    # Emitted only on request; an absent key (not null) is the privacy-preserving default.
    | if $email == "" then . else . + {email: $email} end' >> "$TMP"
done < <(git log --format='%H' --reverse)

{
  echo "[backfill] repo:            $REPO_ROOT"
  echo "[backfill] commits scanned: $TOTAL"
  echo "[backfill] with AI lines:   $WITH_AI"
  echo "[backfill] with notes:      $WITH_NOTES"
} >&2

if [ "$DRY_RUN" = true ]; then
  cat "$TMP"
  echo "[backfill] dry run — nothing written." >&2
  exit 0
fi

mkdir -p "$(dirname "$OUTPUT")"
if [ -f "$OUTPUT" ]; then
  PREV=$(wc -l < "$OUTPUT" | tr -d ' ')
  echo "[backfill] replacing $OUTPUT ($PREV existing entries)" >&2
fi
mv "$TMP" "$OUTPUT"
trap - EXIT
echo "[backfill] wrote $OUTPUT ($TOTAL entries)" >&2
