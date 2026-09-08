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

# Drain stdin if the client provides session context, so we never block on a pipe.
if [ ! -t 0 ]; then
  cat >/dev/null 2>&1 || true
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Every repository the workspace can commit to needs its own marker, because each has its
# own pre-commit reading its own tracking file (ADR-002). Marking only the superproject
# left every submodule at captureVerified=false, so a genuinely human-only commit there
# was reported as `unknown` — indistinguishable from broken capture.
REPOS=("$PROJECT_ROOT")
while read -r sub; do
  [ -n "$sub" ] || continue
  REPOS+=("$sub")
done < <(git -C "$PROJECT_ROOT" submodule --quiet foreach --recursive 'printf "%s\n" "$(pwd)"' 2>/dev/null || true)

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
PROBE_NAME=".attribution-capture-probe"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGGER="${SCRIPT_DIR}/log-ai-edit.sh"

# Probe and mark one repository. The probe path is absolute and inside the target repo, so
# per-file resolution in log-ai-edit.sh routes the entry to that repo's log rather than the
# superproject's — which is what makes this verify the right thing for a submodule.
mark_repo() {
  local repo="$1"
  local tracking="${repo}/${TRACKING_FILE}"
  local probe_abs="${repo}/${PROBE_NAME}"
  local verified="false"

  if [ ! -s "$tracking" ] || ! jq -e . "$tracking" >/dev/null 2>&1; then
    echo '{"edits":[]}' > "$tracking"
  fi

  if [ -f "$LOGGER" ]; then
    local before after landed
    before=$(jq -r '.edits | length' "$tracking" 2>/dev/null || echo 0)

    # Mimic the real client payload shape, snake_case included.
    printf '{"hook_event_name":"PostToolUse","tool_name":"capture_probe","tool_input":{"path":"%s"}}' \
      "$probe_abs" | bash "$LOGGER" >/dev/null 2>&1 || true

    after=$(jq -r '.edits | length' "$tracking" 2>/dev/null || echo 0)
    landed=$(jq -r --arg p "$PROBE_NAME" \
      '[.edits[]? | select(.file == $p)] | length' "$tracking" 2>/dev/null || echo 0)

    if [ "$after" -gt "$before" ] && [ "$landed" -gt 0 ]; then
      verified="true"
    fi

    # Drop the synthetic entry again; it is evidence, not attribution.
    jq --arg p "$PROBE_NAME" '.edits = [.edits[]? | select(.file != $p)]' \
      "$tracking" > "${tracking}.tmp" 2>/dev/null \
      && mv "${tracking}.tmp" "$tracking" \
      || rm -f "${tracking}.tmp"
  fi

  if [ "$verified" != "true" ]; then
    echo "[attribution] WARNING: hooks run, but the edit logger did not capture a test" >&2
    echo "[attribution]   payload in ${repo}. Agent edits there will NOT be attributed." >&2
    echo "[attribution]   Commits will be recorded as 'unknown' rather than claimed as" >&2
    echo "[attribution]   human-authored. See README.md Troubleshooting." >&2
  fi

  jq --arg ts "$TIMESTAMP" --argjson capture "$verified" \
    '{session: {hooksAlive: true, captureVerified: $capture, verifiedAt: $ts,
                trigger: "SessionStart"},
      edits: (.edits // [])}' \
    "$tracking" > "${tracking}.tmp" \
    && mv "${tracking}.tmp" "$tracking"
}

for repo in "${REPOS[@]}"; do
  mark_repo "$repo"
done

exit 0
