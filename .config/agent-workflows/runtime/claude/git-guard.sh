#!/usr/bin/env bash
# git-guard.sh — PreToolUse gate: no edits/commits on a protected branch of a protected repo.
# Spec: ~/.claude/docs/superpowers/specs/2026-07-17-git-control-design.md
# Matchers: Edit|Write|NotebookEdit (file edits) + Bash (git commit interception).
# Exit 2 = block (stderr → model), else 0. FAIL-OPEN: any error → exit 0.
set -uo pipefail

[ -n "${GIT_GUARD_OFF:-}" ] && exit 0
LIB="$HOME/.claude/scripts/hooks/lib/git-policy-lib.sh"
[ -f "$LIB" ] || exit 0
. "$LIB"

input="$(cat 2>/dev/null)" || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || exit 0
session="$(printf '%s' "$input" | jq -r '.session_id // "nosession"' 2>/dev/null)"

FLAG_DIR="$HOME/.claude/run/git-guard"
# Session markers are owned by lifecycle cleanup, not every tool action.

# guard_target <path> <tool-label> → 0 allow; prints block message + returns 2
guard_target() {
  local target="$1" toollabel="$2" repo branch slug dirty
  [ -z "$target" ] && return 0
  repo="$(resolve_repo_root "$target")"
  [ -z "$repo" ] && return 0
  repo_protected "$repo" || return 0
  branch="$(current_branch "$repo")"
  [ -z "$branch" ] && return 0                    # detached HEAD → deliberate state, allow
  branch_protected "$repo" "$branch" || return 0
  slug="$(repo_slug "$repo")"
  [ -f "$FLAG_DIR/$session/$slug" ] && return 0
  dirty="$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  mkdir -p "$HOME/.claude/logs" 2>/dev/null
  printf '%s|%s|%s|%s|block|%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$session" "$repo" "$branch" "$toollabel" \
    >> "$HOME/.claude/logs/git-guard.log" 2>/dev/null
  cat >&2 <<EOM
[git-guard] BLOCKED: $toollabel targets protected branch '$branch' in $repo ($dirty dirty file(s)).
Decide the git route BEFORE editing — do not retry this call as-is:
1. Normal feature/bugfix → branch in place:
     git -C "$repo" checkout -b <type>/<slug>        …then retry the edit.
2. Tree dirty with unrelated changes, parallel sessions likely, or long-running/risky work → isolated worktree:
     git -C "$repo" worktree add -b <type>/<slug> "$HOME/dev/.worktrees/$(basename "$repo")/<slug>"   …then edit there.
3. Already-authorized main-branch work? Preserve that authority; otherwise ask the owner ONCE via
   AskUserQuestion (main / branch / worktree). ONLY after he explicitly answers "main":
     mkdir -p "$FLAG_DIR/$session" && touch "$FLAG_DIR/$session/$slug"     …then retry.
   NEVER write that flag without his explicit approval in this session.
EOM
  return 2
}

case "$tool" in
  Edit|Write)
    target="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
    guard_target "$target" "$tool" || exit 2
    ;;
  NotebookEdit)
    target="$(printf '%s' "$input" | jq -r '.tool_input.notebook_path // empty' 2>/dev/null)"
    guard_target "$target" "$tool" || exit 2
    ;;
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    if printf '%s' "$cmd" | grep -qE '(^|&&|;|\|)[[:space:]]*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit([[:space:]]|$)'; then
      cwdv="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
      # every commit-shaped segment contributes one candidate dir; ANY protected hit blocks
      segs="$(printf '%s' "$cmd" | grep -oE '(^|&&|;|\|)[[:space:]]*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit([[:space:]]|$)')"
      while IFS= read -r seg; do
        [ -z "$seg" ] && continue
        c="$(printf '%s' "$seg" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+commit.*/\1/p')"
        [ -z "$c" ] && c="$cwdv"
        case "$c" in "~") c="$HOME" ;; "~/"*) c="$HOME/${c#\~/}" ;; esac
        guard_target "$c" "Bash(git commit)" || exit 2
      done <<< "$segs"
    fi
    ;;
esac
exit 0
