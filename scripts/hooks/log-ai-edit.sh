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
# Fallback only. The real root is resolved per edited file below, because the repository
# that owns a file is not necessarily the one Kiro was launched in.
CWD_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

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

# --- Resolve the repository that owns this file ------------------------------------
# An edit must be logged into the repository that will commit it, using a path relative
# to that repository, because pre-commit compares against `git diff --cached --name-only`
# with an exact string match.
#
# Deriving one root from Kiro's working directory does not satisfy that. In a submodule
# layout the workspace root is the superproject, so an edit to kiro-metrics-demo/README.md
# was logged as "kiro-metrics-demo/README.md" into the superproject's log, while the
# submodule's pre-commit looked for its own log (absent) and compared against "README.md".
# Neither the location nor the path matched, so agent work committed inside a submodule was
# never attributed. Sibling checkouts were worse: an absolute path outside the workspace
# root was dropped outright.
#
# `git -C <dir> rev-parse --show-toplevel` answers this directly and works for
# superprojects, submodules, plain nested repositories and siblings alike.

# Resolve to an absolute path first so the -C lookup has a real directory to start from.
if [[ "$FILE_PATH" != /* ]]; then
  ABS_PATH="${CWD_ROOT}/${FILE_PATH#./}"
else
  ABS_PATH="$FILE_PATH"
fi

# The file may not exist yet for a create, so walk up to the nearest existing directory.
LOOKUP_DIR="$(dirname "$ABS_PATH")"
PATH_SUFFIX="$(basename "$ABS_PATH")"
while [ ! -d "$LOOKUP_DIR" ] && [ "$LOOKUP_DIR" != "/" ]; do
  PATH_SUFFIX="$(basename "$LOOKUP_DIR")/${PATH_SUFFIX}"
  LOOKUP_DIR="$(dirname "$LOOKUP_DIR")"
done

# Canonicalise to the physical path before comparing against git's answer. On macOS /tmp
# and /var are symlinks (/var -> /private/var), and `rev-parse --show-toplevel` always
# reports the resolved path. Comparing a logical incoming path against it fails the prefix
# test, and the edit is dropped — which is how a sibling-repository edit went missing even
# though the repository was found. `pwd -P` resolves it without GNU-only realpath flags.
LOOKUP_DIR="$(cd "$LOOKUP_DIR" 2>/dev/null && pwd -P || echo "$LOOKUP_DIR")"
ABS_PATH="${LOOKUP_DIR}/${PATH_SUFFIX}"

OWNING_ROOT="$(git -C "$LOOKUP_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$OWNING_ROOT" ]; then
  # Not inside any git repository, so nothing will ever commit it.
  exit 0
fi

case "$ABS_PATH" in
  "$OWNING_ROOT"/*)
    FILE_PATH="${ABS_PATH#"$OWNING_ROOT"/}"
    ;;
  *)
    exit 0
    ;;
esac

# Each repository keeps its own log, consumed by its own pre-commit and reset by its own
# post-commit. A single shared log would be reset by whichever repository committed first,
# discarding edits still pending for the other.
TRACKING_PATH="${OWNING_ROOT}/${TRACKING_FILE}"

# Initialize the tracking file if it is missing, empty, or not valid JSON.
# Testing only `[ ! -f ]` is not enough: a 0-byte or corrupt file passes that check, then
# jq reads no input, emits nothing, and the mv below overwrites the file with nothing —
# so the hook keeps exiting 0 while silently dropping every edit. Empty and corrupt must
# be treated as "needs init", not as "already fine".
if [ ! -s "$TRACKING_PATH" ] || ! jq -e . "$TRACKING_PATH" >/dev/null 2>&1; then
  echo '{"edits":[]}' > "$TRACKING_PATH"
fi

# Append the new entry
ENTRY=$(jq -n \
  --arg file "$FILE_PATH" \
  --arg tool "$TOOL_NAME" \
  --arg ts "$TIMESTAMP" \
  --arg author "kiro" \
  '{file: $file, tool: $tool, timestamp: $ts, author: $author}')

# Guard the mv on a non-empty result so a jq failure can never truncate the log. Silent
# truncation is the worst outcome here: attribution keeps "working" while recording nothing,
# and the missing edits surface later as fabricated human-authored lines.
if jq --argjson entry "$ENTRY" '.edits += [$entry]' "$TRACKING_PATH" > "${TRACKING_PATH}.tmp" 2>/dev/null \
   && [ -s "${TRACKING_PATH}.tmp" ]; then
  mv "${TRACKING_PATH}.tmp" "$TRACKING_PATH"
else
  rm -f "${TRACKING_PATH}.tmp"
  echo "[attribution] WARNING: failed to record edit for ${FILE_PATH}; tracking log left unchanged." >&2
fi

exit 0
