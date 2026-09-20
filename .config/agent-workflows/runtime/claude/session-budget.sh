#!/usr/bin/env bash
# session-budget.sh — UserPromptSubmit gate on session obesity.
#
# WHY (2026-07-26 transcript audit of real sessions):
#   3 sessions held 49% of all Claude Code context spend; 10 held 81%; the worst
#   ran 10,110 assistant turns / 4,933 tool calls / 1.57B cumulative context
#   tokens in ONE session (96.8MB transcript = 4x the usage-report.sh "RETIRE
#   CANDIDATE" threshold). Cost is context x calls, so a long session pays for
#   its whole history on every single call. the owner diagnosed it live in-transcript:
#   "I think you're a little context-rotted."
#
#   usage-report.sh --check already detects this, but only fires a macOS
#   notification from launchd — advisory, out-of-band, and demonstrably ignored.
#   This surfaces it INSIDE the session, at the moment a new prompt lands.
#
# The handoff recipe below is deliberately disk-derived. the owner's own handoffs
# went stale ("three facts in it are stale. Trust disk over that prompt where
# they conflict") because they were written from a rotted context. A handoff
# reconstructed from git + disk does not inherit the rot it exists to escape.
#
# FAIL-OPEN: any error => exit 0, no output. Never blocks submission.
set -uo pipefail

[ -n "${SESSION_BUDGET_OFF:-}" ] && exit 0

# --- advisory session/memory/swap line (2026-07-31) -----------------------
# Independent of the context-budget logic below: this machine runs ~10-13
# concurrent Claude Code sessions costing roughly 420 MB each (~285 MB
# `claude` + ~135 MB MCP servers). That is not a leak — it is the deliberate
# cost of the orchestrator workflow — but swap has been sitting near 95% for
# over a week. Nothing here acts on the number; it just puts it in front of
# the owner so the close-some-sessions call gets made deliberately instead of
# discovered via swap thrash. Runs unconditionally, even on slash-commands
# and bash-bangs, and even if transcript measurement below can't run at all.
hygiene_sessions="$(/bin/ps -Ao comm= 2>/dev/null | grep -cE '(^|/)claude$' || echo 0)"
hygiene_gb="$(/bin/ps -Ao rss=,comm= 2>/dev/null | awk '
  { n=$2; sub(/.*\//,"",n); if (n=="claude"||n=="node"||n=="npm") s+=$1 }
  END { printf "%.1f", s/1048576 }')"
hygiene_swap="$(/usr/sbin/sysctl -n vm.swapusage 2>/dev/null | awk '
  { for (i=1;i<=NF;i++) { if ($i=="total") t=$(i+2)+0; if ($i=="used") u=$(i+2)+0 } }
  END { if (t>0) printf "%d", (u/t)*100; else printf "0" }')"
printf '%s sessions · %s GB · swap %s%%\n' "${hygiene_sessions:-0}" "${hygiene_gb:-0.0}" "${hygiene_swap:-0}"

input="$(cat 2>/dev/null)" || exit 0
tp="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)" || exit 0
[ -z "$tp" ] || [ ! -r "$tp" ] && exit 0

# Skip slash-commands / bash-bangs — they are not the expensive turns.
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)"
case "$(printf '%.1s' "$prompt")" in /|\#|!) exit 0 ;; esac

# --- measure -------------------------------------------------------------
bytes=$(wc -c <"$tp" 2>/dev/null | tr -d ' ') || exit 0
[ -z "$bytes" ] && exit 0
mb=$(( bytes / 1048576 ))

# Most recent real context size = input + cache_read + cache_creation on the
# last assistant usage block. Tail only ~2MB so this stays O(1) on huge files.
# `tail -n +2` drops the partial first line left by the byte-tail; fromjson?
# skips anything unparseable so one bad line can't zero out the measurement.
#
# Two records must be skipped or the measurement silently reads 0:
#   - model "<synthetic>": Claude Code's placeholder for interrupts/errors. Its
#     usage keys all exist but are zero, and it is very often the LAST assistant
#     record in a transcript. `tail -1` was landing on it, so the ctx tier had
#     been dead on those sessions and only MB ever fired. (Bug found 2026-08-01
#     while calibrating; 14 of 190 sampled transcripts ended this way.)
#   - isSidechain: subagent turns carry their own small context and would
#     understate the main session.
# Taking the last NONZERO sum makes both harmless.
ctx=$(tail -c 2000000 "$tp" 2>/dev/null | tail -n +2 \
  | jq -R -r 'fromjson? // empty
      | select(.type == "assistant")
      | select((.isSidechain // false) == false)
      | select((.message.model // "") != "<synthetic>")
      | .message.usage // empty
      | (.input_tokens // 0)
        + (.cache_read_input_tokens // 0)
        + (.cache_creation_input_tokens // 0)
      | select(. > 0)' 2>/dev/null \
  | tail -1)
case "$ctx" in ''|*[!0-9]*) ctx=0 ;; esac

# --- correction signal ----------------------------------------------------
# Size is a proxy; repeated correction is the actual quality signal, and it is
# the one Anthropic's docs name explicitly: "If you've corrected Claude more
# than twice on the same issue in one session, the context is cluttered with
# failed approaches. Run /clear and start fresh."
#
# Measured over 405 main sessions (30d): corrections/session rise 0.04 (<1MB)
# -> 0.25 (1-5MB) -> 1.15 (5-12MB) -> 2.00 (12MB+). Correlated with size but
# NOT redundant: a 2MB session with 3 corrections is poisoned and the size
# tiers stay silent on it.
#
# Scoped to the last CORR_WINDOW human turns so corrections that were already
# resolved earlier in a long session stop counting. Deliberately tight regex —
# it undercounts rather than nagging on ordinary disagreement.
CORR_WINDOW=${SESSION_BUDGET_CORR_WINDOW:-12}
CORR_MIN=${SESSION_BUDGET_CORR_MIN:-2}
CORR_RE='^(no|nope|wrong|stop)\b|(thats|that.s) not|not what i|you (didn.t|did not|were supposed)|i (said|asked|told you)|why did you|revert (that|it)|undo (that|it)|still (broken|failing|wrong)|you (broke|missed)'

corr=$(tail -c 600000 "$tp" 2>/dev/null | tail -n +2 \
  | jq -R -r 'fromjson? // empty
      | select(.type == "user")
      | select((.isSidechain // false) == false)
      | .message.content
      | if type == "string" then .
        elif type == "array" then (map(select(.type == "text").text) | join(" "))
        else empty end
      | select(length > 0) | ascii_downcase' 2>/dev/null \
  | grep -vE '^\[|<(command-name|local-command|system-reminder|bash-input)' \
  | tail -n "$CORR_WINDOW" \
  | grep -cE "$CORR_RE")
case "$corr" in ''|*[!0-9]*) corr=0 ;; esac

# CALIBRATION (2026-08-01, measured over 25,377 main-session transcripts;
# n=176 with >1MB of history — see the percentiles below).
#
#   ctx tokens : p25 147K | median 197K | p75 303K | p90 500K | p95 692K | max 810K
#   transcript : median 5MB | p75 12MB | p90 28MB | p95 60MB | max 105MB
#
# The original ctx thresholds (150K/200K) were written for a 200K context
# window. Every model in rotation now runs 1M (opus-4-8 / opus-5 / fable-5), so
# 200K landed on the MEDIAN: 34% of substantial sessions were told to retire at
# their normal working size, and the soft tier became unreachable (the ctx
# clause was always true once mb>=5, collapsing the gate to `mb>=5`). An alarm
# that fires on a third of sessions is one you stop reading — the exact failure
# this hook was built to fix.
#
# ctx now tracks p75/p90; MB is UNCHANGED because 12/25 already sat on p75/p90
# and was doing the right work. Measured trip rate at these values:
# 16% hard / 18% soft / 66% quiet (was 34/15/51).
SOFT_CTX=${SESSION_BUDGET_SOFT_CTX:-300000}
HARD_CTX=${SESSION_BUDGET_HARD_CTX:-600000}
SOFT_MB=${SESSION_BUDGET_SOFT_MB:-12}
HARD_MB=${SESSION_BUDGET_HARD_MB:-25}

# A big context in a SHORT transcript is not obesity — it is one dense prompt
# (agent dispatch, pasted spec, post-compaction resume). Only treat context as
# the signal once real history has accumulated; MB alone can always trigger.
MIN_MB_FOR_CTX=${SESSION_BUDGET_MIN_MB:-5}

level=none
if { [ "$ctx" -ge "$HARD_CTX" ] && [ "$mb" -ge "$MIN_MB_FOR_CTX" ]; } || [ "$mb" -ge "$HARD_MB" ]; then
  level=hard
elif { [ "$ctx" -ge "$SOFT_CTX" ] && [ "$mb" -ge "$MIN_MB_FOR_CTX" ]; } || [ "$mb" -ge "$SOFT_MB" ]; then
  level=soft
fi

corrected=0
[ "$corr" -ge "$CORR_MIN" ] && corrected=1

[ "$level" = none ] && [ "$corrected" -eq 0 ] && exit 0

ctxk=$(( ctx / 1000 ))

# Quality tier fires independently of size — a small, thrashing session needs
# this and trips no size threshold.
if [ "$corrected" -eq 1 ]; then
  cat <<CORR
[session-budget] $corr correction signals in the last $CORR_WINDOW turns.
Repeated correction means the context now holds the failed approaches as well as
the goal, and they compete. Do NOT just try again in this session.

Stop and state, in one line each: what the owner actually asked for, and what each
failed attempt got wrong. Then say plainly that a fresh session with a prompt
that includes those constraints will beat continuing here, and offer to write it.
If you genuinely believe the next attempt is different in kind — not just another
iteration — say why in one sentence and continue.
CORR
fi

if [ "$level" = soft ]; then
  cat <<SOFT
[session-budget] Context ~${ctxk}K, transcript ${mb}MB — top quartile for this machine.
Every call from here re-pays for this whole history (at cache-read rates, ~0.1x input).
Finish the task in flight, then checkpoint at a clean boundary — do NOT split
mid-implementation. Do not start new unrelated work in this session.

Retiring is not the only option at this tier. If the bulk of the weight is a
resolved detour — a long debug, an abandoned approach, a big file read you are
done with — tell the owner to press Esc Esc (or run /rewind), pick the message just
before that stretch, and choose "Summarize from here". That collapses the detour
and keeps everything before it verbatim, with no handoff file and no cold cache
write. Name the specific stretch you would collapse; do not suggest it generically.
SOFT
elif [ "$level" = hard ]; then
  cat <<HARD
[session-budget] Context ~${ctxk}K, transcript ${mb}MB — OVER the retire threshold.
This session is now the expensive kind: cost is context x calls, and the audit that
produced this gate found 3 such sessions holding 49% of all context spend. Quality
degrades too ("context-rotted").

Unless the owner says otherwise, finish only the task in flight, then RETIRE this session:
invoke the /retire skill and follow it exactly — disk-reconstructed handoff to
tasks/session-state.md, todo pointer, successor prompt, then stop.

If the remaining work is genuinely one or two short turns, say so and finish instead.
HARD
fi

LOGDIR="$HOME/.claude/logs"
mkdir -p "$LOGDIR" 2>/dev/null \
  && printf '%s|%s|ctx=%s|mb=%s|corr=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$ctx" "$mb" "$corr" \
     >> "$LOGDIR/session-budget.log" 2>/dev/null

exit 0
