#!/usr/bin/env bash
# A quiet, fail-open reminder for explicitly requested long-running work.
# State contains only a checksum and timestamp, never prompt text.
set -u

runtime=claude
if [ "${1:-}" = "--runtime" ] && { [ "${2:-}" = claude ] || [ "${2:-}" = codex ]; }; then
  runtime="$2"
elif [ "$#" -gt 0 ]; then
  exit 0
fi

input="$(</dev/stdin)" || exit 0
row="$(printf '%s' "$input" | jq -r '[.prompt // "", .cwd // .project_dir // "", .session_id // .sessionId // .transcript_path // "unknown"] | @tsv' 2>/dev/null)" || exit 0
IFS=$'\t' read -r prompt cwd session_id <<<"$row"
[ -n "${prompt:-}" ] || exit 0
[ -n "${cwd:-}" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

trimmed="${prompt#"${prompt%%[![:space:]]*}"}"
case "$trimmed" in /*|\#*|\!*|'"'*|\'*|\>*) exit 0 ;; esac
lc="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"

# Only a direct request to sustain work earns a reminder. Mentions of these
# words in questions, quoted material, or ordinary implementation work do not.
long_words='long[-[:space:]](running|term)|autonomous|multi[-[:space:]](session|day)|campaign|until.*done|do[[:space:]]not[[:space:]]stop|don.t[[:space:]]stop|resume[-[:space:]]safe'
action_words='run|work|keep|continue|handle|manage|execute|take[[:space:]]+over|do'
explicit_long=0
if [[ "$lc" =~ (^|[.:;][[:space:]]*)($action_words)[[:space:]].*($long_words) ]] || \
   [[ "$lc" =~ ^i[[:space:]]+need[[:space:]]+you[[:space:]]+to[[:space:]].*($long_words) ]]; then
  explicit_long=1
fi
[ "$explicit_long" -eq 1 ] || exit 0

# An active durable plan is already the appropriate continuity mechanism.
if [ -r "$cwd/tasks/todo.md" ]; then
  plan_head="$(head -c 4096 "$cwd/tasks/todo.md" 2>/dev/null)"
  case "$plan_head" in
    *'<!-- long-run:v1 -->'*) [[ "$plan_head" =~ Status:[[:space:]]active ]] && exit 0 ;;
  esac
fi

umask 077
state_root="${AGENT_WORKFLOW_STATE_DIR:-${HOME:-/tmp}/.cache/agent-workflows/prompt-gate}"
mkdir -p "$state_root" 2>/dev/null || exit 0
chmod 700 "$state_root" 2>/dev/null || exit 0

# A checksum keeps filenames safe and scopes state to runtime, session, and cwd.
state_key="$(printf '%s\0%s\0%s' "$runtime" "$session_id" "$cwd" | cksum | awk '{print $1}')" || exit 0
state_file="$state_root/$state_key.state"
lock_dir="$state_root/$state_key.lock"
locked=0
cleanup() { [ "$locked" -eq 1 ] && rmdir "$lock_dir" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if mkdir "$lock_dir" 2>/dev/null; then locked=1; break; fi
  sleep 0.01
done
[ "$locked" -eq 1 ] || exit 0

now="$(date +%s)" || exit 0
objective="$(printf '%s' "$lc" | cksum | awk '{print $1}')" || exit 0
prior_objective=''
reminded=0
stale=0
if [ -r "$state_file" ]; then
  state_mtime="$(stat -f %m "$state_file" 2>/dev/null || stat -c %Y "$state_file" 2>/dev/null || printf 0)"
  case "$state_mtime" in ''|*[!0-9]*) state_mtime=0 ;; esac
  [ $((now - state_mtime)) -ge 86400 ] && stale=1
  while IFS='=' read -r key value; do
    case "$key" in objective) prior_objective="$value" ;; reminded) reminded="$value" ;; esac
  done < "$state_file"
fi
case "$reminded" in 1) ;; *) reminded=0 ;; esac

if [ "$stale" -eq 0 ] && [ "$reminded" -eq 1 ] && [ "$prior_objective" = "$objective" ]; then
  exit 0
fi

tmp_file="$state_root/.$state_key.$$.tmp"
{
  printf 'version=1\n'
  printf 'reminded=1\n'
  printf 'objective=%s\n' "$objective"
  printf 'updated_at=%s\n' "$now"
} > "$tmp_file" 2>/dev/null || exit 0
chmod 600 "$tmp_file" 2>/dev/null || { rm -f "$tmp_file"; exit 0; }
mv -f "$tmp_file" "$state_file" 2>/dev/null || { rm -f "$tmp_file"; exit 0; }

command=/long-run
[ "$runtime" = codex ] && command='$long-run'
printf '[lifecycle-gate] This looks like an explicit long-running request. Consider %s if it needs durable cross-session tracking.\n' "$command"
