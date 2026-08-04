#!/usr/bin/env bash
# log-ai-edit.sh
# Called by the Kiro PostToolUse hook when fs_write, str_replace, or fs_append fires.
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

# Extract relevant fields from the hook context
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // "unknown"' 2>/dev/null || echo "unknown")
FILE_PATH=$(echo "$INPUT" | jq -r '.toolInput.path // .toolInput.targetFile // "unknown"' 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Skip if we couldn't determine the file
if [ "$FILE_PATH" = "unknown" ] || [ "$FILE_PATH" = "null" ]; then
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
