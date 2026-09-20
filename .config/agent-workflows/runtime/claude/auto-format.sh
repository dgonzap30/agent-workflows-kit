#!/usr/bin/env bash
# PostToolUse hook: Auto-format edited files with Prettier
# Runs after Edit/Write — silently formats if Prettier is available

input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')

[ -z "$file" ] && exit 0

# Only format known file types
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md|*.html|*.yml|*.yaml)
    ;;
  *)
    exit 0
    ;;
esac

# Find nearest prettier config by walking up from the file
dir=$(dirname "$file")
while [ "$dir" != "/" ]; do
  if [ -f "$dir/node_modules/.bin/prettier" ]; then
    "$dir/node_modules/.bin/prettier" --write "$file" 2>/dev/null
    exit 0
  fi
  dir=$(dirname "$dir")
done

# Fallback to global npx (slower, only if no local install found)
# Disabled to avoid cold-start latency on every edit
exit 0
