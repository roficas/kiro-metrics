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
  *.kiro-attribution.json|*node_modules*|*package-lock.json|*.git/*)
    exit 0
    ;;
esac

# Make path relative to project root if absolute
if [[ "$FILE_PATH" == /* ]]; then
  FILE_PATH=$(realpath --relative-to="$PROJECT_ROOT" "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
fi

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
