#!/usr/bin/env bash
# PreToolUse hook (Task|Agent|Workflow): teeth for session-budget.sh's swap line.
#
# 2026-08-14 audit: swap sat at 89–97% through multi-agent fan-outs (dyld crash exit 134, the
# 2026-07-30 13-of-29 agent-stall incident, an AskUserQuestion interrupted under pressure) while
# session-budget.sh only *reported* the number. This gates NEW fan-out dispatch at severe
# pressure; already-running agents and queued workflow slots are unaffected.
#
# Same swap computation as session-budget.sh, deliberately — one metric, two consumers.
# FAIL-OPEN: any measurement error => exit 0.
#   FANOUT_GUARD_OFF=1     disable for a session
#   FANOUT_GUARD_BLOCK=95  block threshold (swap %)
#   FANOUT_GUARD_WARN=85   warn threshold
set -u
[ -n "${FANOUT_GUARD_OFF:-}" ] && exit 0

swap=$(/usr/sbin/sysctl -n vm.swapusage 2>/dev/null | awk '
  { for (i=1;i<=NF;i++) { if ($i=="total") t=$(i+2)+0; if ($i=="used") u=$(i+2)+0 } }
  END { if (t>0) printf "%d", (u/t)*100; else printf "-1" }')
case "$swap" in ''|-1|*[!0-9]*) exit 0 ;; esac

BLOCK=${FANOUT_GUARD_BLOCK:-95}
WARN=${FANOUT_GUARD_WARN:-85}

if [ "$swap" -ge "$BLOCK" ]; then
  cat >&2 <<EOF
[fanout-guard] BLOCKED: swap at ${swap}% (threshold ${BLOCK}%). Dispatching more agents at this
pressure is how the 13/29-stall and OOM incidents happened. In order of preference: let running
agents drain and retry; do this unit of work inline instead of fanning out; retire/park idle
sessions; or ask the owner to close sessions. Already-running workflows continue — only NEW dispatch
is gated. (FANOUT_GUARD_OFF=1 disables for a session.)
EOF
  exit 2
fi

if [ "$swap" -ge "$WARN" ]; then
  echo "[fanout-guard] swap at ${swap}% — prefer narrow dispatch (1-2 agents); a wide fan-out here is likely to stall."
fi
exit 0
