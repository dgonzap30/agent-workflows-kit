#!/usr/bin/env python3
# completion-guard.py — Stop-hook logic. Reads Stop-input JSON on stdin, emits decision JSON
# (or nothing), ALWAYS exits 0. Any error => no output (fail-open). See stop-hook/design.md.
import sys, json, os, re, time

HOME = os.path.expanduser("~")
LOG_DIR = os.path.join(HOME, ".claude", "completion-guard")
LOG_FILE = os.path.join(LOG_DIR, "log.jsonl")

def log(rec):
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass

CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".swift", ".sql", ".sh", ".go",
            ".rb", ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".m", ".mm", ".vue",
            ".svelte", ".php", ".scala", ".ex", ".exs")

# Bias deliberately toward OVER-matching: a missed real verification => false block
# (the expensive direction); an over-match => at most a missed block (safe). Intermediate
# tokens (workspace flags, --filter values) are allowed between the pkg manager and subcommand.
VERIFY_RE = re.compile(
    r"\b("
    r"tsc\b|"
    # bounded, separator-excluding gap: caps work per pkg-manager token (no O(n^2)
    # backtracking) and won't match a verify subcommand across a shell separator. The
    # bound (160) absorbs real monorepo multi---filter chains (a large monorepo runs 3-4
    # --filter=@scope/name flags before the subcommand) without going super-linear.
    r"(npm|pnpm|yarn|bun)\b[^&|;\n]{0,160}?\b(test|build|lint|typecheck|check|tsc|t)\b|"
    r"vitest|jest|playwright test|cypress run|"
    r"pytest|python3? -m (pytest|unittest)|python3?\s+[^&|;\n]{0,80}test[^&|;\n]{0,40}\.py|"
    r"ruff\b|mypy\b|tox\b|"
    r"cargo (build|check|test|clippy)|"
    r"go (build|test|vet)|"
    r"swift (build|test)|xcodebuild\b|"
    r"expo (lint|test|prebuild)|"
    r"eslint\b|biome (check|lint)|"
    r"make (test|build|check|lint|all|install)|"
    r"gradlew\b|mvn\b|dotnet (test|build)|"
    r"turbo[ ][^&|;\n]{0,40}?\b(test|build|lint|typecheck|check)\b|"
    r"nx [^&|;\n]{0,40}?\b(test|build|lint|e2e|typecheck)\b|bazel (test|build)|"
    r"just [^&|;\n]{0,20}?\b(test|build|check|lint)\b|cargo nextest|task [^&|;\n]{0,20}?\b(test|build|lint)\b|"
    r"deno (test|check|lint)|mix test|rspec\b|phpunit\b|"
    r"preflight|verification-loop"
    r")\b", re.I)

def _content(entry):
    msg = entry.get("message")
    if not isinstance(msg, dict):
        msg = entry if isinstance(entry, dict) else {}
    return msg.get("content")

# Synthetic user entries that are NOT genuine prompts (slash-command expansions, caveats,
# local-command stdout). Treating one as the boundary would truncate the window and hide
# real edits behind it. Real shapes seen on disk: isMeta:true + "<local-command-caveat>",
# and content starting "<command-name>/clear</command-name>".
_CMD_PREFIXES = ("<command-name>", "<command-message>", "<command-args>",
                 "<local-command", "<command-stdout>", "<bash-")

def _is_command_text(s):
    return s.lstrip().startswith(_CMD_PREFIXES)

def is_user_prompt(entry):
    if entry.get("type") != "user":
        return False
    if entry.get("isMeta") or entry.get("isSidechain"):
        return False
    c = _content(entry)
    if isinstance(c, str):
        return not _is_command_text(c)
    if isinstance(c, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
            return False
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text" and _is_command_text(b.get("text", "")):
                return False
        return True
    return False

def window_since_last_user(entries):
    boundary = 0
    for i in range(len(entries) - 1, -1, -1):
        if is_user_prompt(entries[i]):
            boundary = i
            break
    return entries[boundary:]

def last_assistant_text(entries):
    # last assistant text block in the window (fallback when last_assistant_message is absent)
    for e in reversed(entries):
        if e.get("type") != "assistant":
            continue
        c = _content(e)
        if isinstance(c, str) and c.strip():
            return c
        if isinstance(c, list):
            joined = "\n".join(str(b.get("text") or "") for b in c
                               if isinstance(b, dict) and b.get("type") == "text")
            if joined.strip():
                return joined
    return ""

def iter_tool_uses(entries):
    for e in entries:
        if e.get("type") != "assistant":
            continue
        c = _content(e)
        if not isinstance(c, list):
            continue
        for b in c:
            if isinstance(b, dict) and b.get("type") == "tool_use":
                yield b.get("name", ""), (b.get("input") or {})

def scan(entries):
    # Per-response (v1): scan only since the last genuine user prompt. The cross-turn
    # session-wide variant (v1.1) was explored and PARKED — a session-wide scan false-blocks
    # honest non-edit stops on a stale earlier edit, because "edit prior turn + 'done' now"
    # is structurally indistinguishable from an unrelated later "done". See design.md.
    window = window_since_last_user(entries)
    files, last_edit_pos, verify_positions, pos = [], -1, [], 0
    for name, inp in iter_tool_uses(window):
        pos += 1
        if name in ("Edit", "Write", "NotebookEdit"):
            fp = inp.get("file_path") or inp.get("notebook_path") or ""
            if fp.endswith(CODE_EXT):
                files.append(os.path.basename(fp))
                last_edit_pos = pos
        elif name == "Bash":
            cmd = inp.get("command", "") or ""
            if VERIFY_RE.search(cmd[:4000]):  # hard cap: belt-and-suspenders vs regex blowup
                verify_positions.append(pos)
    edited_code = len(files) > 0
    verified_after = edited_code and any(p > last_edit_pos for p in verify_positions)
    return edited_code, files, verified_after

SIGNOFF_CHARS = 240  # genuine sign-offs sit at the very end; wider windows catch mid-message prose

# Genuine completion SIGN-OFFS only. Backtest on real transcripts showed bare
# done/fixed/passes match incidental prose ("would have done", "Docker not done",
# "fixed" in a plan) -> require completion phrases, not lone verbs.
CLAIM_RE = re.compile(
    r"("
    r"\ball done\b|\bthat'?s done\b|\bnow done\b|\b(is|are|it'?s) done\b|"
    r"\bi'?m done\b|\bwe'?re done\b|\bdone[!.]|\bdone\s*[—-]|"
    r"\ball set\b|\bgood to go\b|\bready to (go|ship|merge|deploy|land)\b|"
    r"\bimplemented\b|\bfinished\b|\bcompleted\b|"
    r"\b(is|now) fixed\b|\bfixed (it|the|that)\b|"
    r"✅|\U0001F389"
    r")", re.I)

RUNTIME_RE = re.compile(
    r"\b(works now|working now|renders? (correctly|fine|now)|displays? (correctly|now)|"
    r"shows? (up|correctly|now)|animat(es|ing|ed)( now)?|"
    r"the (ui|screen|app|page|view|button|component|modal|list) (now |correctly )?"
    r"(works|shows|displays|renders|looks|updates)|fixed the (crash|bug|issue|error)|"
    r"no longer (crashes|errors|breaks)|looks (right|correct|good|great)|"
    r"you('?ll| will| should) see)\b", re.I)

ESCAPE_RE = re.compile(
    r"\b(haven'?t (run|tested|verified|tried)|did ?n'?t (run|test|verify)|"
    r"could ?n'?t (run|test|verify)|can'?t (verify|test|run)|unable to (run|test|verify)|"
    r"not (yet )?(tested|verified|run|been able)|untested|without (running|testing|verifying)|"
    r"i have not (run|tested|verified)|"
    r"you('?ll| will| may want to| should| need to)?( need to| want to)? "
    r"(test|verify|run|check) (it|this|that|locally|on)|"
    r"please (test|verify|run|check)|needs (manual )?(testing|verification|qa)|"
    r"verify (this )?(on|in) (device|hardware|the simulator|the browser))\b", re.I)

def text_signals(final_response):
    text = final_response or ""
    signoff = text[-SIGNOFF_CHARS:]
    claim = bool(CLAIM_RE.search(signoff))
    runtime_claim = bool(RUNTIME_RE.search(signoff))
    honest_escape = bool(ESCAPE_RE.search(text))
    return claim, runtime_claim, honest_escape

def classify(edited_code, verified_after, claim, runtime_claim, honest_escape):
    if edited_code and claim and not verified_after and not honest_escape:
        return "block"
    if runtime_claim and not honest_escape:
        return "nudge"
    return "allow"

def render(decision, files, final_response):
    if decision == "block":
        uniq = list(dict.fromkeys(files))
        reason = (
            f'You edited code ({len(uniq)} file(s): {", ".join(uniq)}) and reported completion, '
            "but no verification command (tsc / tests / build / lint) ran after your last edit. "
            "Before stopping: run the project's check and confirm it passes — or, if you "
            "genuinely can't verify in this environment, say so explicitly and state what still "
            'needs checking. Evidence before "done."'
        )
        return {"decision": "block", "reason": reason}
    if decision == "nudge":
        m = RUNTIME_RE.search((final_response or "")[-SIGNOFF_CHARS:])
        snippet = (m.group(0) if m else "")[:80]
        ctx = (
            f'You asserted runtime/visual behavior ("{snippet}"). If you actually ran or saw it, '
            "say so. If you're inferring from the code, state that it's unverified at runtime so "
            "the user knows to check."
        )
        return {"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": ctx}}
    return {}

def in_school(cwd):
    if not cwd:
        return False
    try:
        base = os.path.join(HOME, os.environ.get("AGENT_SCHOOL_DIR", "school")) + os.sep
        return os.path.abspath(cwd).startswith(base)
    except Exception:
        return False

def load_transcript_tail(path, max_lines=1500):
    # stream from the file tail so memory stays bounded regardless of transcript size
    from collections import deque
    with open(path, "r", errors="replace") as f:
        lines = deque(f, maxlen=max_lines)
    out = []
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except Exception:
            pass
    return out

def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return
    mode = os.environ.get("COMPLETION_GUARD_MODE", "shadow")
    cwd = data.get("cwd", "") or ""
    tpath = data.get("transcript_path", "") or ""

    if in_school(cwd):
        return

    try:
        # FIX 3: load 5000 lines so the judge gets its intended cross-turn window
        # (JUDGE_SESSION_LINES). v1 decision is window_since_last_user bounded so its
        # behavior is unchanged even with the larger load.
        entries = load_transcript_tail(tpath, max_lines=5000) if tpath and os.path.isfile(tpath) else []
    except Exception:
        entries = []

    # Stop input field is `last_assistant_message` (per Claude Code changelog). Accept
    # `final_response` only as a defensive alias, then fall back to the last assistant text
    # block in the current response window.
    text = data.get("last_assistant_message") or data.get("final_response") or ""
    if not isinstance(text, str):
        text = ""
    if not text:
        text = last_assistant_text(window_since_last_user(entries))

    edited_code, files, verified_after = scan(entries)
    claim, runtime_claim, honest_escape = text_signals(text)

    # --- v2 judge tier (additive; v1 above is untouched) ---
    def render_judge_nudge(reason):
        """Judge-specific nudge message — fires on a premature CODE-COMPLETION claim (med confidence).
        Deliberately separate from v1's render() to avoid the runtime/visual-behavior template."""
        ctx = ("A completion claim may be premature: code was changed in this session but no "
               "verification (tests/typecheck/build/lint) ran afterward. If you verified it, "
               "say how; otherwise note what still needs checking. (judge: "
               + (reason or "")[:160] + ")")
        return {"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": ctx}}

    def _run_judge_tier():
        """Consult the LLM judge; emit + return True if judge fires in enforce, else False."""
        try:
            test_verdict = os.environ.get("JUDGE_TEST_VERDICT")
            if test_verdict:                          # test-only seam, never set in prod
                # Support optional reason suffix: JUDGE_TEST_VERDICT=nudge:some reason
                parts = test_verdict.split(":", 1)
                tdec = parts[0]
                treason = parts[1] if len(parts) > 1 else ""
                jd = {"decision": tdec, "log": {"prefilter_hit": True, "test": True,
                                                 "reason": treason}}
            else:
                import judge as _judge                 # local import: any import error => skip
                api_key = os.environ.get("SKILL_ROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or ""
                cache_dir = os.path.join(LOG_DIR, "judge-cache")
                jd = _judge.judge_decision(entries, text, api_key, cache_dir=cache_dir)
            jlog = jd.get("log")
            jdec = jd.get("decision", "allow")
            # FIX 2: log on EVERY prefilter hit, not just block/nudge (calibration corpus)
            if (jlog or {}).get("prefilter_hit"):
                log({"ts": int(time.time()), "cwd": cwd, "mode": mode, "tier": "judge",
                     "decision": jdec, "judge": jlog})
            judge_enforce = os.environ.get("COMPLETION_GUARD_JUDGE") == "enforce"
            if jdec in ("block", "nudge") and mode == "enforce" and judge_enforce:
                files_j = (jlog or {}).get("unverified_edits", [])
                jreason = (jlog or {}).get("reason", "")
                if jdec == "block":
                    sys.stdout.write(json.dumps(render("block", files_j, text)))
                else:  # nudge
                    sys.stdout.write(json.dumps(render_judge_nudge(jreason)))
                return True
        except Exception:
            pass   # fail-open: judge never breaks the hook
        return False

    if not edited_code and not runtime_claim:
        _run_judge_tier()  # FIX 4: dead in_school guard removed (main() already returns above)
        return  # nothing to guard (v1); judge ran above if applicable

    decision = classify(edited_code, verified_after, claim, runtime_claim, honest_escape)
    log({
        "ts": int(time.time()), "cwd": cwd, "mode": mode, "decision": decision,
        "edited_code": edited_code, "files": files[:10], "verified_after": verified_after,
        "claim": claim, "runtime_claim": runtime_claim, "honest_escape": honest_escape,
        "claim_snippet": text[-120:],
    })

    if decision == "allow":   # only when v1 didn't fire; FIX 4: dead in_school guard removed
        if _run_judge_tier():
            return

    if mode == "enforce" and decision != "allow":
        # 2026-09-01 audit decision 1: the deterministic tier blocked ~20% of stops with visible false
        # positives while the LLM judge only logged. Inverted: v1 may only NUDGE (additionalContext);
        # a hard block now comes solely from the judge tier (COMPLETION_GUARD_JUDGE=enforce).
        sys.stdout.write(json.dumps(render("nudge", files, text)))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
