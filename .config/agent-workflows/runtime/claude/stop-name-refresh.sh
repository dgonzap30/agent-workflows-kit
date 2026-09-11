#!/usr/bin/env bash
# Stop hook: refresh the auto-generated session name shown in the status line + Ghostty title.
# Cheap, throttled, and fully detached — adds zero latency to the turn.
# Skips when: nested name-gen (recursion), a manual #name is pinned, a native
# aiTitle already names the session, or it was regenerated < 120s ago.
set -uo pipefail
[ -n "${CLAUDE_SESSION_NAME_GEN:-}" ] && exit 0   # recursion guard (nested claude -p)

input="$(cat 2>/dev/null)" || exit 0
sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
tp="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
{ [ -z "$sid" ] || [ -z "$tp" ]; } && exit 0
[ -f "$tp" ] || exit 0

# Native titles already feed the status line. Avoid a duplicate model call.
if tail -c 131072 "$tp" 2>/dev/null | jq -R -e 'fromjson? | select(.type == "ai-title" and (.aiTitle | type == "string" and length > 0))' >/dev/null 2>&1; then
  exit 0
fi

[ -s "/tmp/claude-session-label-${sid}" ] && exit 0          # manual #name wins; spend nothing

NAME_FILE="/tmp/claude-session-name-${sid}"
if [ -f "$NAME_FILE" ]; then
  m=$(stat -f %m "$NAME_FILE" 2>/dev/null || stat -c %Y "$NAME_FILE" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - m )) -lt 120 ] && exit 0              # throttle
fi
touch "$NAME_FILE" 2>/dev/null || true                       # debounce concurrent stops

# Detached so the turn never waits on Haiku.
( nohup bash "$HOME/.claude/scripts/hooks/session-name-gen.sh" "$sid" "$tp" >/dev/null 2>&1 & ) </dev/null
exit 0
