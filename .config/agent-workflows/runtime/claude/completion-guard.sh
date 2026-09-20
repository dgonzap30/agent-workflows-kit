#!/usr/bin/env bash
# Stop hook entry — delegates to completion-guard.py. Fail-open: any problem => exit 0, no output.
set -uo pipefail
[ -n "${COMPLETION_GUARD_OFF:-}" ] && exit 0
PY="${HOME:-/tmp}/.claude/scripts/hooks/completion-guard.py"
[ -r "$PY" ] || exit 0
python3 "$PY" 2>/dev/null || true
exit 0
