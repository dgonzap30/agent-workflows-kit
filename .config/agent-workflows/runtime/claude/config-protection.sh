#!/usr/bin/env bash
# PreToolUse hook: Warn when editing config files
# Exit 0 with warning stdout (doesn't block, just informs Claude)

input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')

[ -z "$file" ] && exit 0

# Hard gate: block the AI from self-modifying its own global Claude config.
# Defense-in-depth under defaultMode:auto — settings/permissions/instructions
# should only change deliberately, not as a silent side effect of a task.
# Escape hatch for an intentional, user-approved edit:
#   export ALLOW_CLAUDE_CONFIG_EDIT=1   (then restart the session)
case "$file" in
  "$HOME/.claude/settings.json"|"$HOME/.claude/settings.local.json"|"$HOME/.claude/CLAUDE.md"|"$HOME/.claude/rules/"*)
    if [ "${ALLOW_CLAUDE_CONFIG_EDIT:-0}" != "1" ]; then
      echo "⛔ Blocked: edit to global Claude config ($file)." >&2
      echo "   This guards against the AI silently changing its own permissions/instructions under auto-mode." >&2
      echo "   For a deliberate change: edit the file manually, or restart with ALLOW_CLAUDE_CONFIG_EDIT=1 exported." >&2
      exit 2
    fi
    ;;
esac

basename=$(basename "$file")

case "$basename" in
  .eslintrc*|.prettierrc*|prettier.config*|biome.json*)
    echo "⚠ Editing linter/formatter config ($basename). Fix the code to match the config, don't weaken the config to match the code."
    ;;
  tsconfig*.json)
    # Check if the edit loosens strict mode
    new_str=$(echo "$input" | jq -r '.tool_input.new_string // empty')
    if echo "$new_str" | grep -qE '"strict"\s*:\s*false'; then
      echo "⚠ DO NOT disable TypeScript strict mode. Fix the type errors instead." >&2
      exit 2
    fi
    ;;
esac

exit 0
