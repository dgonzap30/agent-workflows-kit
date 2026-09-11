# Agent instruction routing

Use the current runtime's global workflow policy (`~/.codex/AGENTS.md` for Codex or `~/.claude/CLAUDE.md` for Claude Code) and the nearest project instructions. This home entry contains no independent model, delegation, approval, stack-version, or compaction policy. If the runtime already loaded its global policy, do not read it again.

If this machine has a workspace map, the runtime policy names it.
