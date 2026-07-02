#!/bin/bash
# PreToolUse hook: Edit|Write|Bash (see settings.json's matcher). Implements
# §2.1 component 1. Fails closed on any internal error in this script — an
# error here must block the write, not silently allow it.
#
# Claude Code only *blocks* a tool call on exit code 2; any other non-zero
# exit is a non-blocking hook error (shown as a warning, write proceeds). So
# "fail closed" requires an explicit trap that forces exit 2 — without it, a
# crash in this script (or in parse-tool-call.mjs) fails OPEN by accident,
# because `set -u` on an unset var, or the exit status of a command
# substitution feeding `eval`, does not itself surface as exit 2.
set -euo pipefail
trap 'echo "{\"action\":\"internal_error\",\"reason\":\"enforce-gate.sh failed unexpectedly - failing closed (CONST-CORE-004)\"}" >&2; exit 2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$(cat)"
eval "$(printf '%s' "$PAYLOAD" | node "$SCRIPT_DIR/parse-tool-call.mjs")"

if [[ -z "${HARNESS_TOOL_NAME:-}" ]]; then
  echo '{"action":"internal_error","reason":"enforce-gate.sh: parse-tool-call.mjs produced no output - failing closed (CONST-CORE-004)"}' >&2
  exit 2
fi

if [[ "$HARNESS_TOOL_NAME" != "Edit" && "$HARNESS_TOOL_NAME" != "Write" && "$HARNESS_TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Conservative heuristic (Open Item #8): a Bash call with no recognized write
# target is not gated here. post-bash-revert.sh's git-diff backstop
# (§2.1 component 4) is what catches whatever this misses — a false negative
# here is not a silent bypass of the whole mechanism.
if [[ "$HARNESS_TOOL_NAME" == "Bash" && -z "$HARNESS_FILE_PATH" ]]; then
  exit 0
fi

# `trap ... ERR` fires on any qualifying failing command regardless of
# set -e/+e — it is NOT gated by errexit being active, only by the same
# exemption list (bash gotcha, confirmed empirically: the trap fired on
# gate-check.js's *intentional* nonzero exit here, stomping the real
# directive JSON with the generic internal_error message). Disable the trap
# for this one deliberate exit-status check, then restore it.
trap - ERR
set +e
RESULT_JSON=$(docker exec harness_gate_daemon node cli/dist/gate-check.js \
  --project-path "$HARNESS_PROJECT_PATH" \
  --tool "$HARNESS_TOOL_NAME" \
  --file "$HARNESS_FILE_PATH" 2>&1)
STATUS=$?
set -e
trap 'echo "{\"action\":\"internal_error\",\"reason\":\"enforce-gate.sh failed unexpectedly - failing closed (CONST-CORE-004)\"}" >&2; exit 2' ERR

if [[ $STATUS -ne 0 ]]; then
  # Directive-shaped JSON (§2.1) — same envelope as directives.ts — so Claude
  # can read it from stderr and self-correct on its next turn.
  echo "$RESULT_JSON" >&2
  exit 2
fi

exit 0
