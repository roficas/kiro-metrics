#!/usr/bin/env bash
# mark-session-start.sh
# Called by the Kiro SessionStart hook. Records whether agent edits can actually be
# captured in this session, so pre-commit never has to guess.
#
# Why this exists
# ---------------
# An empty .kiro-attribution.json is ambiguous. It means either:
#   (a) the agent genuinely edited nothing, or
#   (b) edits were not captured at all.
#
# pre-commit could not tell those apart, so it assumed (a) and emitted
# `ai-authorship: human-only`. That records agent work as human work — and it fails
# in the flattering direction, reporting less AI authorship than reality with no
# error anywhere. For an attribution tool that is the worst available failure mode.
#
# With a marker, pre-commit has three states instead of two:
#   capture verified + edits    -> attribute normally
#   capture verified + no edits -> genuinely human-only, trustworthy
#   capture unverified          -> unknown, and say so out loud
#
# The marker survives commits (post-commit clears `edits` but preserves `session`)
# so every commit in the session stays trustworthy, not just the first.

set -euo pipefail

TRACKING_FILE=".kiro-attribution.json"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TRACKING_PATH="${PROJECT_ROOT}/${TRACKING_FILE}"

# Drain stdin if the client provides session context, so we never block on a pipe.
if [ ! -t 0 ]; then
  cat >/dev/null 2>&1 || true
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ! -f "$TRACKING_PATH" ]; then
  echo '{"edits":[]}' > "$TRACKING_PATH"
fi

# If the file is unreadable or malformed, start clean rather than fail the hook.
if ! jq -e . "$TRACKING_PATH" >/dev/null 2>&1; then
  echo '{"edits":[]}' > "$TRACKING_PATH"
fi

# --- Capture probe --------------------------------------------------------------
# "The client ran a hook" and "the logger understood the payload" are different
# claims, and they have already failed independently: the Kiro IDE sends snake_case
# keys while log-ai-edit.sh once read only camelCase, so PostToolUse ran, found no
# path, and exited 0 silently. A marker asserting only liveness would have said
# everything was fine over a permanently empty log, which pre-commit reads as
# trustworthy human-only. That is precisely the false confidence to avoid.
#
# So prove capture empirically rather than assuming it: push a synthetic payload
# through the real logger and confirm an entry actually lands.
#
# The probe path is deliberately a file that never exists and is never staged, so
# even if the cleanup below fails it cannot match a staged file in pre-commit and
# cannot inflate anyone's attribution.
PROBE_PATH=".attribution-capture-probe"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGGER="${SCRIPT_DIR}/log-ai-edit.sh"

CAPTURE_VERIFIED="false"
if [ -f "$LOGGER" ]; then
  BEFORE=$(jq -r '.edits | length' "$TRACKING_PATH" 2>/dev/null || echo 0)

  # Mimic the real client payload shape, snake_case included.
  printf '{"hook_event_name":"PostToolUse","tool_name":"capture_probe","tool_input":{"path":"%s"}}' \
    "$PROBE_PATH" | bash "$LOGGER" >/dev/null 2>&1 || true

  AFTER=$(jq -r '.edits | length' "$TRACKING_PATH" 2>/dev/null || echo 0)
  LANDED=$(jq -r --arg p "$PROBE_PATH" \
    '[.edits[]? | select(.file == $p)] | length' "$TRACKING_PATH" 2>/dev/null || echo 0)

  if [ "$AFTER" -gt "$BEFORE" ] && [ "$LANDED" -gt 0 ]; then
    CAPTURE_VERIFIED="true"
  fi

  # Drop the synthetic entry again; it is evidence, not attribution.
  jq --arg p "$PROBE_PATH" '.edits = [.edits[]? | select(.file != $p)]' \
    "$TRACKING_PATH" > "${TRACKING_PATH}.tmp" 2>/dev/null \
    && mv "${TRACKING_PATH}.tmp" "$TRACKING_PATH" \
    || rm -f "${TRACKING_PATH}.tmp"
fi

if [ "$CAPTURE_VERIFIED" != "true" ]; then
  echo "[attribution] WARNING: hooks run, but the edit logger did not capture a test" >&2
  echo "[attribution]   payload. Agent edits will NOT be attributed this session." >&2
  echo "[attribution]   Commits will be recorded as 'unknown' rather than claimed as" >&2
  echo "[attribution]   human-authored. Check scripts/hooks/log-ai-edit.sh against the" >&2
  echo "[attribution]   payload your client sends. See README.md Troubleshooting." >&2
fi

jq --arg ts "$TIMESTAMP" --argjson capture "$CAPTURE_VERIFIED" \
  '{session: {hooksAlive: true, captureVerified: $capture, verifiedAt: $ts,
              trigger: "SessionStart"},
    edits: (.edits // [])}' \
  "$TRACKING_PATH" > "${TRACKING_PATH}.tmp" \
  && mv "${TRACKING_PATH}.tmp" "$TRACKING_PATH"

exit 0
