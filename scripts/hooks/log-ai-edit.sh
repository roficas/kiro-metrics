#!/usr/bin/env bash
# log-ai-edit.sh
# Called by the Kiro PostToolUse hook when any write tool fires: fs_write, str_replace,
# fs_append, smart_relocate, or semantic_rename (see the matcher in
# .kiro/hooks/track-ai-edits.json, and the field-extraction notes below).
# Reads JSON from stdin (Kiro session context), extracts the file path and tool name,
# and appends an attribution entry to .kiro-attribution.json.
#
# Attribution tracking flow:
#   1. This script logs every agent file-edit with timestamp and tool used
#   2. Git pre-commit hook reads .kiro-attribution.json at commit time
#   3. Pre-commit computes AI vs human lines for staged files
#   4. Trailers and git notes are written with line-level attribution
#   5. Post-commit clears the tracking file for the next cycle

set -euo pipefail

TRACKING_FILE=".kiro-attribution.json"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TRACKING_PATH="${PROJECT_ROOT}/${TRACKING_FILE}"

# Read stdin (Kiro passes session context as JSON)
INPUT=$(cat)

# Extract relevant fields from the hook context.
#
# Payload key casing differs by client, so accept both. The Kiro IDE sends snake_case:
#   {"hook_event_name":"PostToolUse","tool_name":"str_replace","tool_input":{"path":"..."}}
# Earlier versions of this script read only camelCase (.toolName/.toolInput). Against the
# IDE both resolved to null, FILE_PATH became "unknown", and the guard below exited 0 — so
# every agent edit was silently dropped and every commit was reported as human-only.
# Do not narrow these expressions to a single casing again.
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .toolName // "unknown"' 2>/dev/null || echo "unknown")
# Different write tools name their target differently:
#   fs_write / str_replace / fs_append / semantic_rename -> path
#   delete_file                                          -> targetFile
#   smart_relocate                                       -> destinationPath
FILE_PATH=$(echo "$INPUT" | jq -r '
  (.tool_input // .toolInput // {}) as $in
  | $in.path // $in.destinationPath // $in.targetFile // "unknown"
  ' 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Skip if we couldn't determine the file.
# This is the failure mode that hid the casing bug, so it complains on the way out instead
# of exiting silently. Still exit 0: a PostToolUse hook must never block the tool.
if [ "$FILE_PATH" = "unknown" ] || [ "$FILE_PATH" = "null" ]; then
  echo "[attribution] WARNING: could not find a file path in the PostToolUse payload." >&2
  echo "[attribution]   tool_name=${TOOL_NAME}. The payload shape may have changed;" >&2
  echo "[attribution]   this edit is NOT being attributed. See README.md Troubleshooting." >&2
  exit 0
fi

# Skip tracking files, lock files, and non-project files
case "$FILE_PATH" in
  *.kiro-attribution.json|*.kiro-attribution-staged.json|*node_modules*|*package-lock.json|*.git/*)
    exit 0
    ;;
esac

# Make path relative to project root if absolute.
# Done with pure bash prefix stripping rather than `realpath --relative-to`, which is a
# GNU coreutils flag that BSD/macOS realpath doesn't support. The previous version failed
# silently there and fell back to the absolute path, which never matches the repo-relative
# paths git reports in pre-commit — so every AI edit was misfiled as human-authored.
if [[ "$FILE_PATH" == /* ]]; then
  case "$FILE_PATH" in
    "$PROJECT_ROOT"/*)
      FILE_PATH="${FILE_PATH#"$PROJECT_ROOT"/}"
      ;;
    *)
      # Edit landed outside the repo — nothing meaningful to attribute.
      exit 0
      ;;
  esac
fi

# Normalise a leading ./ so paths match git's output exactly
FILE_PATH="${FILE_PATH#./}"

# Initialize tracking file if it doesn't exist
if [ ! -f "$TRACKING_PATH" ]; then
  echo '{"edits":[]}' > "$TRACKING_PATH"
fi

# Append the new entry
ENTRY=$(jq -n \
  --arg file "$FILE_PATH" \
  --arg tool "$TOOL_NAME" \
  --arg ts "$TIMESTAMP" \
  --arg author "kiro" \
  '{file: $file, tool: $tool, timestamp: $ts, author: $author}')

jq --argjson entry "$ENTRY" '.edits += [$entry]' "$TRACKING_PATH" > "${TRACKING_PATH}.tmp" \
  && mv "${TRACKING_PATH}.tmp" "$TRACKING_PATH"

exit 0
