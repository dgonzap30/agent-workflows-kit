#!/usr/bin/env bash
# Claude Code status line.
# Campaign-aware (hub map) · width-adaptive + guaranteed-fit (COLUMNS) · Dracula palette · 2 lines.

input=$(cat)

# ── Palette: neon, with hue reservation ──────────────────────────────────────
#   HUE = category.   Each family owns a hue and keeps it everywhere.
#   WARM = alarm.     Amber and red are reserved. Nothing else is ever warm, so
#                     anything warm on this line is asking for you.
#   BOLD + ⬢ = identity, never colour alone.
#
# Everything is full-saturation neon. The earlier "mute the data so identity
# stands out" rule is gone — it made the line grey and unscannable. Identity is
# distinguished structurally (bold, glyph, first token of line 1), which frees
# every colour to be as vivid as it wants without weakening the alarm layer.
tc() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }

# ── RESERVED WARM: the only two colours that mean "act" ──────────────────────
AMBER=$(tc 251 191 36)     # amber-400 · STATE: notice — worth knowing
RED=$(tc 248 113 113)      # red-400   · STATE: urgent — act now

# ── AXIS 2: HUE = category ───────────────────────────────────────────────────
# Every data hue is now full-saturation neon. The category system is unchanged —
# hue still says what a number IS — but nothing is dialled back any more.
#
# Identity no longer relies on being the ONLY vivid thing, because it does not
# need to: it is always bold, always prefixed with ⬢, and always the first token
# of line 1. Three redundant signals, so identity and data can both be vivid
# without either being mistaken for the other.
#
# What still protects the alarm layer is HUE RESERVATION, not saturation: amber
# and red are warm, and no identity or data colour is warm. Anything warm on this
# line is a warning, full stop.
# Tailwind's 400 ramp throughout. On a near-black background what makes a colour
# glow is high LIGHTNESS held together with high chroma — the 500 ramp sits around
# L*60, which is why it read deep but soft. 400 is ~L*75 with the chroma intact.
# One ramp for everything: identity does not need to spend lightness distinguishing
# itself, because it is already bold, ⬢-prefixed and first on line 1.
DIM=$(tc 100 116 139)      # slate-500   · structure — recedes on purpose
SLATE=$(tc 148 163 184)    # slate-400   · PLACE  — branch, worktree
STEEL=$(tc 56 189 248)     # sky-400     · BUDGET — context window, rate limits
SAGE=$(tc 52 211 153)      # emerald-400 · SPEND  — cost, duration
MOSS=$(tc 163 230 53)      # lime-400    · OUTPUT — lines added
CLAY=$(tc 232 121 249)     # fuchsia-400 · OUTPUT — lines removed (NOT red: red means act)
LILAC=$(tc 167 139 250)    # violet-400  · ENGINE — model, effort

CYAN=$(tc 34 211 238)      # cyan-400    · IDENTITY
GREEN=$(tc 74 222 128)     # green-400   · IDENTITY
PURPLE=$(tc 192 132 252)   # purple-400  · IDENTITY
PINK=$(tc 244 114 182)     # pink-400    · IDENTITY
AZURE=$(tc 96 165 250)     # blue-400    · IDENTITY

ACCENT="$CYAN"             # legacy alias: un-named hub campaigns
YELLOW="$AMBER"            # legacy alias
ORANGE="$AMBER"            # legacy alias
BLUE="$AZURE"              # legacy alias
FG=$(tc 248 248 242)       # goal text only
B='\033[1m'
X='\033[0m'

HUB_MAP="${HUB_MAP:-$HOME/.config/work/hub}"
PANE_MAP="${PANE_MAP:-$HOME/.config/work/panes}"
PANE_STATE="${PANE_STATE:-$HOME/.local/state/claude/panes}"

# ── Width mode: panes run small — compact is the default ──
COLS="${COLUMNS:-100}"
case "$COLS" in ''|*[!0-9]*) COLS=100 ;; esac
if [ "$COLS" -ge 110 ]; then
  WIDE=1; SEP=" ${DIM}│${X} "; BLOCKS=8; BRW=32
else
  WIDE=0; SEP=" ${DIM}·${X} "; BLOCKS=5; BRW=18
fi
SEPW=3   # visible width of either separator

# Visible length of a segment (ANSI stripped, chars not bytes).
vis() { printf '%b' "$1" | sed $'s/\x1b\[[0-9;]*m//g' | wc -m | tr -d ' '; }

# Truncate $1 to <= $2 chars, breaking on a word boundary, ellipsis when cut.
trunc() {
  local s="$1" n="$2" cut
  [ "${#s}" -le "$n" ] && { printf '%s' "$s"; return; }
  cut="${s:0:$n}"; cut="${cut% *}"
  printf '%s…' "$cut"
}

# ── Single jq extraction ──
eval "$(echo "$input" | jq -r '
  @sh "model_id=\(.model.id // "")",
  @sh "cost_usd=\(.cost.total_cost_usd // 0)",
  @sh "dur_ms=\(.cost.total_duration_ms // 0)",
  @sh "used_pct=\(.context_window.used_percentage // "")",
  @sh "lines_add=\(.cost.total_lines_added // 0)",
  @sh "lines_rm=\(.cost.total_lines_removed // 0)",
  @sh "five_h=\(.rate_limits.five_hour.used_percentage // "")",
  @sh "seven_d=\(.rate_limits.seven_day.used_percentage // "")",
  @sh "effort_level=\(.effort.level // "")",
  @sh "fast_mode=\(.fast_mode // false)",
  @sh "pr_num=\(.pr.number // "")",
  @sh "pr_state=\(.pr.review_state // "")",
  @sh "cwd=\(.workspace.current_dir // .cwd // "")",
  @sh "wt_name=\(.worktree.name // "")",
  @sh "sess_name=\(.session_name // "")",
  @sh "transcript_path=\(.transcript_path // "")",
  @sh "session_id=\(.session_id // "")"
' | tr ',' '\n')"

proj=$(basename "$cwd" 2>/dev/null)

# ── Pane identity: DECLARED, not derived. $CLAUDE_PANE is set by the launcher
# and verified to reach this subprocess; the by-cwd binding is what `goal` writes
# so an already-running pane can be named in place without a relaunch.
# Anything unrecognisable fails open to the pre-existing campaign/project path. ──
# Resolution order, most durable first:
#   1. $CLAUDE_PANE            — declared at launch
#   2. by-session/<id>         — sticky: survives the agent cd-ing anywhere
#   3. by-cwd/<dir>, walking UP through parents
#   4. (falls through to hub campaign / basename below)
#
# Keying on cwd ALONE was the bug: `.workspace.current_dir` follows the agent,
# not the process, so a daemon repo shortens to `brain` and an app repo to `ios`
# the moment work moved into a subdirectory. Walking parents fixes the subdir
# case; the by-session write-through makes it permanent, so once a pane is
# identified even once it keeps that name for the rest of its life.
pane="${CLAUDE_PANE:-}"
if [ -z "$pane" ] && [ -n "$session_id" ] && [ -f "$PANE_STATE/by-session/$session_id" ]; then
  pane=$(head -1 "$PANE_STATE/by-session/$session_id" 2>/dev/null | tr -d '\n')
fi
if [ -z "$pane" ] && [ -n "$cwd" ] && [ -d "$PANE_STATE/by-cwd" ]; then
  probe="$cwd"
  while [ -n "$probe" ] && [ "$probe" != "/" ]; do
    ck=$(printf '%s' "$probe" | tr '/ ' '__')
    if [ -f "$PANE_STATE/by-cwd/$ck" ]; then
      pane=$(head -1 "$PANE_STATE/by-cwd/$ck" 2>/dev/null | tr -d '\n')
      break
    fi
    probe=$(dirname "$probe" 2>/dev/null) || break
  done
fi
case "$pane" in *[!A-Za-z0-9._-]*) pane="" ;; esac

# Write-through: pin this session to the name so step 2 answers next time and no
# later cd can take it away.
if [ -n "$pane" ] && [ -n "$session_id" ] && [ ! -f "$PANE_STATE/by-session/$session_id" ]; then
  mkdir -p "$PANE_STATE/by-session" 2>/dev/null &&
    printf '%s\n' "$pane" > "$PANE_STATE/by-session/$session_id" 2>/dev/null
fi

# ── Pane accent: explicit map first so a regular pane's hue never shifts, then a
# stable hash of the name so ad-hoc panes still differ. RED and YELLOW are absent
# on purpose — they mean "warning" elsewhere on this line. ──
pane_hue=""
if [ -n "$pane" ]; then
  cname=""
  if [ -f "$PANE_MAP" ]; then
    cname=$(awk -F'|' -v n="$pane" '!/^[[:space:]]*#/ && NF>=2 {
      k=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",k)
      if (k==n) { v=$2; gsub(/^[[:space:]]+|[[:space:]]+$/,"",v); print v; exit }
    }' "$PANE_MAP" 2>/dev/null)
  fi
  if [ -z "$cname" ]; then
    hsum=$(printf '%s' "$pane" | cksum 2>/dev/null | cut -d' ' -f1)
    case "$hsum" in ''|*[!0-9]*) hsum=0 ;; esac
    case $(( hsum % 5 )) in
      0) cname=cyan ;; 1) cname=green ;; 2) cname=purple ;;
      3) cname=pink ;; *) cname=azure ;;
    esac
  fi
  # Only IDENTITY hues are reachable here. orange/amber/red are refused on
  # purpose: if a pane could be amber, amber would stop meaning "look at this".
  case "$cname" in
    cyan)  pane_hue="$CYAN"  ;; green) pane_hue="$GREEN"  ;;
    purple) pane_hue="$PURPLE" ;; pink) pane_hue="$PINK"  ;;
    azure) pane_hue="$AZURE" ;;
    *)     pane_hue="$CYAN"  ;;
  esac
fi

# ── Live goal (pane-scoped, written by `goal`). A stale goal must LOOK stale
# rather than lie quietly, so past 3h it dims and carries its age. ──
# Read with bash builtins, not sed|tr|cut: `tr` aborts with "Illegal byte
# sequence" on a binary file, and that error would leak into the pane. A size cap
# bounds a file with no newlines. Anything malformed yields an empty goal.
g_txt=""; g_dim=0; g_h=0
if [ -n "$pane" ] && [ -f "$PANE_STATE/$pane.goal" ]; then
  g_sz=$(stat -f %z "$PANE_STATE/$pane.goal" 2>/dev/null || stat -c %s "$PANE_STATE/$pane.goal" 2>/dev/null || echo 0)
  case "$g_sz" in ''|*[!0-9]*) g_sz=0 ;; esac
  if [ "$g_sz" -gt 0 ] && [ "$g_sz" -le 4096 ]; then
    g_ts_raw=""; g_txt_raw=""
    { IFS= read -r g_ts_raw; IFS= read -r g_txt_raw; } < "$PANE_STATE/$pane.goal" 2>/dev/null
    case "$g_ts_raw" in ''|*[!0-9]*) g_ts="" ;; *) g_ts="$g_ts_raw" ;; esac
    g_txt="${g_txt_raw//[$'\001'-$'\037'$'\177']/}"
    g_txt="${g_txt:0:140}"
    # Emitting invalid UTF-8 corrupts the terminal's rendering of the whole pane,
    # so a goal that isn't valid UTF-8 is dropped rather than printed. The glob
    # skips iconv entirely for pure-ASCII goals, which is nearly all of them.
    case "$g_txt" in
      *[!\ -~]*) g_txt=$(printf '%s' "$g_txt" | iconv -f UTF-8 -t UTF-8 2>/dev/null) || g_txt="" ;;
    esac
    if [ -n "$g_txt" ] && [ -n "$g_ts" ]; then
      g_age=$(( $(date +%s) - g_ts ))
      [ "$g_age" -lt 0 ] && g_age=0
      if [ "$g_age" -ge 10800 ]; then g_dim=1; g_h=$(( g_age / 3600 )); fi
    fi
  fi
fi

# ── Campaign identity: hub map lookup by session id ──
campaign=""
if [ -n "$session_id" ] && [ -f "$HUB_MAP" ]; then
  campaign=$(awk -F'|' -v sid="$session_id" '!/^[[:space:]]*#/ && NF>=3 {
    s=$3; gsub(/^[[:space:]]+|[[:space:]]+$/,"",s)
    if (s==sid) { n=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",n); print n; exit }
  }' "$HUB_MAP" 2>/dev/null)
fi

# ── Model ──
case "$model_id" in
  *fable-5-1*)    model="fable 5.1" ;;
  *fable-5*)      model="fable 5" ;;
  *opus-4-8*1m*)  model="opus 4.8 1M" ;;
  *opus-4-8*)     model="opus 4.8" ;;
  *opus-4-7*1m*)  model="opus 4.7 1M" ;;
  *opus-4-7*)     model="opus 4.7" ;;
  *opus-4-6*)     model="opus 4.6" ;;
  *opus*)         model="opus" ;;
  *sonnet-4-6*)   model="sonnet 4.6" ;;
  *sonnet-4-5*)   model="sonnet 4.5" ;;
  *sonnet*)       model="sonnet" ;;
  *haiku-4-5*)    model="haiku 4.5" ;;
  *haiku*)        model="haiku" ;;
  *)              model=$(echo "$input" | jq -r '.model.display_name // "claude"' | tr '[:upper:]' '[:lower:]') ;;
esac

# ── Context bar: fuel gauge — each block wears its zone color ──
if [ -n "$used_pct" ]; then
  pct_int=$(printf "%.0f" "$used_pct")
  filled=$(( pct_int * BLOCKS / 100 ))
  [ "$filled" -gt "$BLOCKS" ] && filled=$BLOCKS

  bar=""
  for (( i=1; i<=BLOCKS; i++ )); do
    if [ "$i" -le "$filled" ]; then
      pos=$(( i * 100 / BLOCKS ))
      if   [ "$pos" -lt 60 ]; then zc="$STEEL"
      elif [ "$pos" -lt 80 ]; then zc="$AMBER"
      else                         zc="$RED"; fi
      bar+="${zc}▰"
    else
      bar+="${DIM}▱"
    fi
  done
  bar+="$X"

  if   [ "$pct_int" -ge 80 ]; then pct_color="${RED}${B}"
  elif [ "$pct_int" -ge 60 ]; then pct_color="${AMBER}"
  else                             pct_color="${STEEL}"; fi
  ctx="${bar} ${pct_color}${pct_int}%${X}"
else
  bar=""
  for (( i=1; i<=BLOCKS; i++ )); do bar+="▱"; done
  ctx="${DIM}${bar} --%${X}"
fi

# ── Cost ──
cost_fmt=$(awk -v c="$cost_usd" 'BEGIN {
  if (c+0 == 0) printf "$0.00"
  else if (c < 0.01) printf "$%.4f", c
  else if (c < 1) printf "$%.3f", c
  else printf "$%.2f", c
}')
# Cost thresholds are deliberately HIGH. On a Max plan the dollar figure is
# notional — the thing that can actually stop the day is the rate limit, which
# has its own segment. A $33 session is an ordinary one here, so it must read as
# ordinary; colouring it red taught the eye to ignore red. Amber only once a
# single session is genuinely large, red only when it is an outlier.
if awk -v c="$cost_usd" 'BEGIN { exit !(c >= 150) }'; then
  cost="${RED}${B}${cost_fmt}${X}"
elif awk -v c="$cost_usd" 'BEGIN { exit !(c >= 75) }'; then
  cost="${AMBER}${cost_fmt}${X}"
else
  cost="${SAGE}${cost_fmt}${X}"
fi

# ── Duration (fold hours) ──
mins=$(( dur_ms / 60000 ))
if [ "$mins" -ge 60 ]; then
  duration="${SAGE}$(( mins / 60 ))h$(( mins % 60 ))m${X}"
elif [ "$mins" -gt 0 ]; then
  duration="${SAGE}${mins}m${X}"
else
  duration="${SAGE}$(( (dur_ms % 60000) / 1000 ))s${X}"
fi

# ── Git branch + dirty flag (cached 5s, per-session) ──
CACHE="/tmp/claude-statusline-git-${session_id:-default}"
branch=""; dirty=""
if [ -n "$cwd" ]; then
  now=$(date +%s)
  cache_age=999
  if [ -f "$CACHE" ]; then
    cache_mtime=$(stat -f %m "$CACHE" 2>/dev/null || stat -c %Y "$CACHE" 2>/dev/null || echo 0)
    cache_age=$(( now - cache_mtime ))
    cache_dir=$(sed -n 1p "$CACHE" 2>/dev/null)
  fi
  if [ "$cache_age" -gt 5 ] || [ "$cache_dir" != "$cwd" ]; then
    b=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
    d=""
    if [ -n "$b" ]; then
      [ -n "$(git -C "$cwd" --no-optional-locks status --porcelain -uno 2>/dev/null | head -1)" ] && d=1
    fi
    printf '%s\n%s\n%s\n' "$cwd" "$b" "$d" > "$CACHE"
    branch="$b"; dirty="$d"
  else
    branch=$(sed -n 2p "$CACHE" 2>/dev/null)
    dirty=$(sed -n 3p "$CACHE" 2>/dev/null)
  fi
fi
branch_part=""
if [ -n "$branch" ]; then
  branch_part="${SLATE}⎇ $(trunc "$branch" $BRW)${X}"
  [ -n "$dirty" ] && branch_part="${branch_part}${RED}${B}*${X}"
fi

# ── Lines changed ──
lines_part=""
if [ "$lines_add" -gt 0 ] || [ "$lines_rm" -gt 0 ]; then
  lines_part="${MOSS}+${lines_add}${X} ${CLAY}−${lines_rm}${X}"
fi

# ── Rate limits (compact: "61·38%", wide: "61%/5h 38%/7d") ──
rate_part=""
if [ -n "$five_h" ]; then
  five_int=$(printf "%.0f" "$five_h")
  # The real constraint. Escalates earlier than anything else on the line.
  if [ "$five_int" -ge 85 ]; then rc="${RED}${B}"
  elif [ "$five_int" -ge 60 ]; then rc="${AMBER}"
  else rc="$STEEL"; fi
  if [ "$WIDE" = 1 ]; then
    rate_part="${rc}${five_int}%${X}${DIM}/5h${X}"
  else
    rate_part="${rc}${five_int}${X}"
  fi
fi
if [ -n "$seven_d" ]; then
  seven_int=$(printf "%.0f" "$seven_d")
  if [ "$seven_int" -ge 90 ]; then rc7="${RED}${B}"
  elif [ "$seven_int" -ge 70 ]; then rc7="${AMBER}"
  else rc7="$STEEL"; fi
  if [ "$WIDE" = 1 ]; then
    rate_part="${rate_part} ${rc7}${seven_int}%${X}${DIM}/7d${X}"
  elif [ -n "$rate_part" ]; then
    rate_part="${rate_part}${DIM}·${X}${rc7}${seven_int}%${X}"
  else
    rate_part="${rc7}${seven_int}%${X}"
  fi
fi

# ── Worktree ──
wt_part=""
if [ -n "$wt_name" ]; then
  if [ "$WIDE" = 1 ]; then wt_part="${SLATE}wt:${wt_name}${X}"
  else wt_part="${SLATE}wt:$(trunc "$wt_name" 12)${X}"; fi
fi

# ── Fleet: other live hub campaigns (shared cache, 15s). Small panes get a count. ──
fleet_part=""
FLEET_CACHE="/tmp/claude-hub-fleet"
if [ -f "$HUB_MAP" ]; then
  fnow=$(date +%s); fage=999
  if [ -f "$FLEET_CACHE" ]; then
    fm=$(stat -f %m "$FLEET_CACHE" 2>/dev/null || stat -c %Y "$FLEET_CACHE" 2>/dev/null || echo 0)
    fage=$(( fnow - fm ))
  fi
  if [ "$fage" -gt 15 ]; then
    # A campaign is "open" when its transcript was written RECENTLY — not when a
    # process merely exists. Matching "claude --resume" in argv missed every pane
    # launched as `claude "<prompt>"`, which is all of them; the only thing it ever
    # caught was an 18-hour-idle orphan, reported as if it were live work.
    # Transcript mtime is one stat per row, and recent-activity is the more useful
    # meaning: an abandoned session should drop off the board on its own.
    live=""
    while IFS='|' read -r n d s _; do
      n=$(printf '%s' "$n" | tr -d '[:space:]')
      s=$(printf '%s' "$s" | tr -d '[:space:]')
      d=$(printf '%s' "$d" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      case "$n" in ''|\#*) continue ;; esac
      { [ -z "$s" ] || [ "$s" = "-" ] || [ -z "$d" ]; } && continue
      tf="$HOME/.claude/projects/$(printf '%s' "$d" | sed 's|[/.]|-|g')/$s.jsonl"
      [ -f "$tf" ] || continue
      tm=$(stat -f %m "$tf" 2>/dev/null || stat -c %Y "$tf" 2>/dev/null || echo 0)
      [ $(( fnow - tm )) -le 600 ] && live="$live $n"
    done < "$HUB_MAP"
    printf '%s' "$live" > "$FLEET_CACHE"
  fi
  live=$(cat "$FLEET_CACHE" 2>/dev/null)
  others=""; ocount=0
  for n in $live; do
    [ "$n" = "$campaign" ] && continue
    others="$others $n"; ocount=$(( ocount + 1 ))
  done
  others="${others# }"
  if [ "$ocount" -gt 0 ]; then
    if [ "$WIDE" = 1 ] && [ "$ocount" -le 3 ]; then
      fleet_part="${DIM}open: ${others}${X}"
    else
      fleet_part="${DIM}⬢${ocount}${X}"
    fi
  fi
fi

# ── Model + effort (+ fast mode). Baseline is xhigh — a pane silently
# below it is misconfigured, so sub-baseline effort renders bold yellow. ──
model_part="${LILAC}${model}${X}"
if [ -n "$effort_level" ]; then
  case "$effort_level" in
    xhigh|max) ec="$DIM" ;;
    *)         ec="${YELLOW}${B}" ;;
  esac
  model_part="${model_part} ${ec}${effort_level}${X}"
fi
[ "$fast_mode" = "true" ] && model_part="${model_part} ${YELLOW}⚡${X}"

# ── Linked PR ──
pr_part=""
if [ -n "$pr_num" ]; then
  case "$pr_state" in
    APPROVED)           pc="$GREEN" ;;
    CHANGES_REQUESTED)  pc="$RED" ;;
    *)                  pc="$DIM" ;;
  esac
  pr_part="${pc}PR#${pr_num}${X}"
fi

# ── Whale-transcript nudge (>25MB = cache-prefix burn) ──
whale_part=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  tsz=$(stat -f %z "$transcript_path" 2>/dev/null || stat -c %s "$transcript_path" 2>/dev/null || echo 0)
  if [ "$tsz" -gt 26214400 ]; then
    if [ "$WIDE" = 1 ]; then
      whale_part="${RED}${B}⚠ $((tsz / 1048576))MB transcript — /compact or respawn${X}"
    else
      whale_part="${RED}${B}⚠$((tsz / 1048576))MB${X}"
    fi
  fi
fi

# ── Task: manual label > Haiku name > native session name > aiTitle ──
task=""
LABEL_FILE="/tmp/claude-session-label-${session_id}"
NAME_FILE="/tmp/claude-session-name-${session_id}"
if [ -n "$session_id" ] && [ -s "$LABEL_FILE" ]; then
  task=$(head -1 "$LABEL_FILE")
elif [ -n "$session_id" ] && [ -s "$NAME_FILE" ]; then
  task=$(head -1 "$NAME_FILE")
elif [ -n "$sess_name" ]; then
  task="$sess_name"
elif [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  TASK_CACHE="/tmp/claude-statusline-task-${session_id}"
  tnow=$(date +%s); tage=999
  if [ -f "$TASK_CACHE" ]; then
    tm=$(stat -f %m "$TASK_CACHE" 2>/dev/null || stat -c %Y "$TASK_CACHE" 2>/dev/null || echo 0)
    tage=$(( tnow - tm ))
  fi
  if [ "$tage" -gt 3 ]; then
    task=$(tail -c 131072 "$transcript_path" | grep '"type":"ai-title"' | tail -1 | jq -r '.aiTitle // empty' 2>/dev/null)
    printf '%s' "$task" > "$TASK_CACHE"
  else
    task=$(cat "$TASK_CACHE" 2>/dev/null)
  fi
fi

# ── Identity: declared pane (own hue) > campaign (accent) > bare project ──
if [ -n "$pane" ]; then
  ident="${pane_hue}${B}⬢ ${pane}${X}"
elif [ -n "$campaign" ]; then
  ident="${ACCENT}${B}⬢ ${campaign}${X}"
else
  ident="${FG}${B}⬢ ${proj:-~}${X}"
fi

# The task slot used to echo "<proj>@<branch>" — which line 1 already shows in
# full. That duplicate is what made four panes read identically; drop it.
if [ -n "$task" ] && [ -n "$branch" ]; then
  case "$task" in *"@$branch") task="" ;; esac
fi

# ── Goal is AUTONOMOUS by default ────────────────────────────────────────────
# There is exactly one "what is this pane doing" slot, and it fills itself. The
# Stop hook already regenerates a session name every ≥120s via Haiku, so falling
# back to it means the goal is populated without anyone maintaining it. A manual
# `goal` still wins when you want to pin something the summariser cannot know
# (a constraint like "do not dispatch"), but it is never required.
# One slot, one place on the line — `task` is not rendered again on line 2.
# A manual goal wins only while it is fresh. Past 3h it is SUPERSEDED by the
# auto name rather than merely dimmed — otherwise "autonomous by default" would
# still need you to come back and clear a pin. A stale pin with no auto name to
# fall back on stays visible but dimmed with its age, which is honest.
g_auto=0
if [ -n "$task" ] && { [ -z "$g_txt" ] || [ "$g_dim" = 1 ]; }; then
  g_txt="$task"; g_dim=0; g_h=0; g_auto=1
fi
task=""

# ══ Render — guaranteed fit: accept segments in priority order while they
# fit in COLS, then assemble in display order. Nothing ever wraps. ══
budget=$(( COLS - 1 ))

# ── Line 1 — WHO / WHY / WHERE. Identity, intent, place. Nothing numeric.
# This is the line you scan across four panes, so it stays short and stable:
# the only colour is the pane's own hue and the dirty marker. ──
used=$(vis "$ident")
a_branch=""; a_wt1=""; a_model=""
gseg=""
if [ -n "$g_txt" ]; then
  if [ "$WIDE" = 1 ]; then gmax=54; else gmax=38; fi
  gt=$(trunc "$g_txt" "$gmax")
  if [ "$g_dim" = 1 ]; then gseg="${DIM}${gt} ·${g_h}h${X}"; else gseg="${FG}${gt}${X}"; fi
  n=$(vis "$gseg")
  if [ $(( used + 2 + n )) -le "$budget" ]; then used=$(( used + 2 + n )); else gseg=""; fi
fi
if [ -n "$branch_part" ]; then
  n=$(vis "$branch_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_branch=1; used=$(( used + SEPW + n )); }
fi
if [ -n "$wt_part" ]; then
  n=$(vis "$wt_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_wt1=1; used=$(( used + SEPW + n )); }
fi

line1="${ident}"
# Two spaces, not a separator: identity and goal read as one unit — which pane, why.
[ -n "$gseg" ]     && line1="${line1}  ${gseg}"
[ -n "$a_branch" ] && line1="${line1}${SEP}${branch_part}"
[ -n "$a_wt1" ] && line1="${line1}${SEP}${wt_part}"

# ── Line 2 — HOW MUCH. Pure telemetry, uniformly dim. A segment only takes
# colour when it crosses a threshold worth looking at, so anything coloured here
# is by definition something to act on. Order runs cheapest-glance to rarest. ──
used=$(vis "$ctx")
a_cost=""; a_dur=""
n=$(vis "$cost");  [ $(( used + SEPW + n )) -le "$budget" ] && { a_cost=1; used=$(( used + SEPW + n )); }
if [ -n "$a_cost" ]; then
  n=$(vis "$duration"); [ $(( used + 3 + n )) -le "$budget" ] && { a_dur=1; used=$(( used + 3 + n )); }
fi
n=$(vis "$model_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_model=1; used=$(( used + SEPW + n )); }
a_whale=""; a_rate=""; a_fleet=""; a_pr=""; a_lines=""
if [ -n "$whale_part" ]; then
  n=$(vis "$whale_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_whale=1; used=$(( used + SEPW + n )); }
fi
if [ -n "$rate_part" ]; then
  n=$(vis "$rate_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_rate=1; used=$(( used + SEPW + n )); }
fi
if [ -n "$fleet_part" ]; then
  n=$(vis "$fleet_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_fleet=1; used=$(( used + SEPW + n )); }
fi
if [ -n "$pr_part" ]; then
  n=$(vis "$pr_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_pr=1; used=$(( used + SEPW + n )); }
fi
if [ -n "$lines_part" ]; then
  n=$(vis "$lines_part"); [ $(( used + SEPW + n )) -le "$budget" ] && { a_lines=1; used=$(( used + SEPW + n )); }
fi

line2="${ctx}"
if [ -n "$a_cost" ]; then
  line2="${line2}${SEP}${cost}"
  [ -n "$a_dur" ] && line2="${line2} ${DIM}·${X} ${duration}"
fi
[ -n "$a_lines" ]  && line2="${line2}${SEP}${lines_part}"
[ -n "$a_model" ] && line2="${line2}${SEP}${model_part}"
[ -n "$a_rate" ]   && line2="${line2}${SEP}${rate_part}"
[ -n "$a_pr" ]     && line2="${line2}${SEP}${pr_part}"
[ -n "$a_fleet" ]  && line2="${line2}${SEP}${fleet_part}"
[ -n "$a_whale" ]  && line2="${line2}${SEP}${whale_part}"

printf '%b\n%b' "$line1" "$line2"

# Ghostty split title (OSC 2). A declared pane puts its goal in the tab bar, so
# the tabs carry the mission instead of repeating the branch three times.
ttl_name="${pane:-${campaign:-$proj}}"
if [ -n "$pane" ] && [ -n "$g_txt" ]; then
  ttl="${ttl_name} · $(trunc "$g_txt" 34)"
elif [ -n "$task" ]; then
  ttl="${ttl_name} · $(trunc "$task" 28)"
elif [ -n "$branch" ]; then
  ttl="${ttl_name}@${branch}"
else
  ttl="$ttl_name"
fi
printf '\033]2;%s\007' "$ttl"
