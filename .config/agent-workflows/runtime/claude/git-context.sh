#!/usr/bin/env bash
# git-context.sh — SessionStart (startup|resume): git state only; workflow policy is owned by the shared kernel.
# Spec: ~/.claude/docs/superpowers/specs/2026-07-17-git-control-design.md
# stdout → injected session context. FAIL-OPEN: any error → exit 0, no output.
set -uo pipefail

[ -n "${GIT_GUARD_OFF:-}" ] && exit 0
LIB="$HOME/.claude/scripts/hooks/lib/git-policy-lib.sh"
[ -f "$LIB" ] || exit 0
. "$LIB"

input="$(cat 2>/dev/null)" || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
[ -z "$cwd" ] && exit 0

repo="$(resolve_repo_root "$cwd")"
[ -z "$repo" ] && exit 0

branch="$(current_branch "$repo")"; [ -z "$branch" ] && branch="(detached)"
prot="no"; repo_protected "$repo" && prot="YES"
dirty="$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
ab="$(git -C "$repo" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null \
      | awk '{print "behind " $1 ", ahead " $2}')"
[ -z "$ab" ] && ab="no upstream"
inwt="no"
[ "$(git -C "$repo" rev-parse --git-dir 2>/dev/null)" != "$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" ] \
  && inwt="yes"

wt_entries=()
wtl="$(git -C "$repo" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | grep -vxF "$repo")"
if [ -n "$wtl" ]; then
  while IFS= read -r w; do
    [ -z "$w" ] && continue
    wt_entries+=("$w (last commit $(git -C "$w" log -1 --format=%cr 2>/dev/null || echo '?'))")
  done <<< "$wtl"
fi

# Disk scan: surface convention-dir worktrees git itself doesn't know about (stale buildup).
conv_dir="$HOME/dev/.worktrees/$(basename "$repo")"
if [ -d "$conv_dir" ]; then
  for d in "$conv_dir"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    printf '%s\n' "$wtl" | grep -qxF "$d" && continue
    age="$(git -C "$d" log -1 --format=%cr 2>/dev/null)"
    wt_entries+=("$d (${age:-?}, not git-registered — stale?)")
  done
fi

# Hygiene nudge (2026-08-25 repo-hygiene program): registered worktrees idle >14d (by last commit)
# + local branches whose upstream is gone (merged/deleted remotely). Report-only — never prunes.
stale_wt=0
if [ -n "$wtl" ]; then
  now_ts="$(date +%s)"
  while IFS= read -r w; do
    [ -z "$w" ] && continue
    ts="$(git -C "$w" log -1 --format=%ct 2>/dev/null)" || continue
    [ -n "$ts" ] && [ $(( (now_ts - ts) / 86400 )) -ge 14 ] && stale_wt=$((stale_wt + 1))
  done <<< "$wtl"
fi
gone_br="$(git -C "$repo" for-each-ref --format='%(upstream:track)' refs/heads/ 2>/dev/null | grep -c '\[gone\]' | tr -d ' ')"
[ -z "$gone_br" ] && gone_br=0
hyg_line=""
if [ "$stale_wt" -gt 0 ] || [ "$gone_br" -gt 0 ]; then
  hyg_line="[git-context] hygiene: ${stale_wt} worktree(s) idle >14d · ${gone_br} local branch(es) with a gone upstream — run \`pnpm hygiene\` (repos that ship it) or \`git branch -vv | grep gone\`"$'\n'
fi

wt="none"
if [ "${#wt_entries[@]}" -gt 0 ]; then
  wt="${wt_entries[0]}"
  for ((i = 1; i < ${#wt_entries[@]}; i++)); do
    wt="$wt · ${wt_entries[i]}"
  done
fi

cat <<EOM
[git-context] repo: $repo · branch: $branch · protected: $prot · dirty: $dirty · upstream: $ab · in-worktree: $inwt
[git-context] worktrees: $wt
${hyg_line}
EOM
exit 0
