#!/usr/bin/env bash
# lib/git-policy-lib.sh — shared repo-resolution + protection logic for git-guard/git-context.
# Sourced, not executed. Fail-open: unexpected state → empty output / non-zero return.
# Policy: ~/dev/git-policy.json (spec §Policy file). Tests override via GIT_POLICY_FILE.

GIT_POLICY_FILE="${GIT_POLICY_FILE:-$HOME/dev/git-policy.json}"

_gp_expand() { case "$1" in "~/"*) printf '%s\n' "$HOME/${1#\~/}" ;; *) printf '%s\n' "$1" ;; esac; }

_gp_list() { # _gp_list <jq-path> → expanded entries, one per line
  [ -f "$GIT_POLICY_FILE" ] || return 0
  jq -r "$1 // [] | .[]" "$GIT_POLICY_FILE" 2>/dev/null | while IFS= read -r p; do _gp_expand "$p"; done
}

resolve_repo_root() { # <path> → repo toplevel or nothing (path may not exist yet)
  local d="$1"
  [ -f "$d" ] && d="$(dirname "$d")"
  while [ ! -d "$d" ] && [ "$d" != "/" ]; do d="$(dirname "$d")"; done
  [ -d "$d" ] || return 0
  git -C "$d" rev-parse --show-toplevel 2>/dev/null
}

repo_slug() { printf '%s' "$1" | sed 's|^/||' | tr '/' '-'; }

repo_protected() { # <root> → 0 if protected; exempt > protect > origin heuristic
  # Capture lists before matching: piping _gp_list's per-line writer into an
  # early-exiting `grep -q` dies on SIGPIPE under the callers' pipefail, which
  # silently discarded early-listed exempt entries.
  local root="$1" list
  list="$(_gp_list '.exempt')"
  case $'\n'"$list"$'\n' in *$'\n'"$root"$'\n'*) return 1 ;; esac
  list="$(_gp_list '.protect')"
  case $'\n'"$list"$'\n' in *$'\n'"$root"$'\n'*) return 0 ;; esac
  git -C "$root" remote get-url origin >/dev/null 2>&1
}

protected_branches() { # <root> → newline list; repoOverrides.branches replaces global
  local root="$1" ov=""
  if [ -f "$GIT_POLICY_FILE" ]; then
    ov="$(jq -r --arg home "$HOME" --arg root "$root" '
      (.repoOverrides // {}) | to_entries[]
      | select((.key | sub("^~/"; $home + "/")) == $root)
      | .value.branches // [] | .[]' "$GIT_POLICY_FILE" 2>/dev/null)"
  fi
  if [ -n "$ov" ]; then
    printf '%s\n' "$ov"
  elif [ -f "$GIT_POLICY_FILE" ] && jq -e '.protectedBranches' "$GIT_POLICY_FILE" >/dev/null 2>&1; then
    jq -r '.protectedBranches[]' "$GIT_POLICY_FILE" 2>/dev/null
  else
    printf 'main\nmaster\nproduction\nprod\nrelease\n'
  fi
}

branch_protected() { # same capture-then-match discipline as repo_protected (SIGPIPE/pipefail)
  local list
  list="$(protected_branches "$1")"
  case $'\n'"$list"$'\n' in *$'\n'"$2"$'\n'*) return 0 ;; esac
  return 1
}

current_branch() { git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null; }
