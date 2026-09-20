# Changelog

All notable changes to the agent-workflows kit are recorded here. Format is
free-form (not Keep a Changelog); each entry is dated and scoped to what
shipped, not what changed in the surrounding dotfiles repo.

## 2.2.1 — 2026-09-14

- `path-guard.sh` and its test moved out of the public kit into `local/claude-hooks/` (private remap history); manifest refreshed.

## 2.2.0 — 2026-09-14

Quality-bar pass (WP-M2-2). No script's decision logic changed.

- Versioned the remaining 17 live Claude Code hook scripts `policy/claude-settings.json`
  and `policy/assets.json` don't reference (`bash-shape-guard.sh`,
  `commit-quality.sh`, `dev-server-block.sh`, `env-protection.sh`,
  `frozen-repo-guard.sh`, `gh-repo-guard.sh`, `inject-stack-rules.sh`,
  `judge.py`, `pre-compact-backup.sh`, `project-inventory-guard.sh`,
  `rules-probe.sh`, `session-label.sh`, `session-name-gen.sh`,
  `session-reap.sh`, `session-start-title.sh`, `task-completed-tsc.sh`) plus
  `helm-emit.sh` (its canonical source is the separate `helm` repo; this is a
  synced copy). Each ships byte-identical, verified with `cmp` against the
  live copy, plus one `node:test` regression test (allow + block for guards,
  one nominal case otherwise) — all in temp dirs with injected env, no
  network, no touching real `~/.claude`/`~/.codex`.
- These live in a new **personal/local layer**, `local/claude-hooks/` at the
  repo root — tracked in git but outside `.config/agent-workflows/`
  (`managedRoot`), so the installer's manifest/`--check`/`--install` never
  see them and the `publish/agent-workflows-kit` export never carries them.
  See `local/claude-hooks/README.md`.
- Corrected a latent inconsistency this pass found: `git-context.sh` and
  `stop-name-refresh.sh` were previously asserted "out of kit scope,
  host-local" in this README, but `policy/assets.json` actually installs
  both onto the live host on `--install` — they were already versioned kit
  files, just untested. They stay in `.config/agent-workflows/runtime/claude/`
  (public kit) and each now has a regression test; `manifest.json` gained
  their two test-file entries.
- Regenerated `manifest.json`, refreshed the README hook inventory, and this
  changelog entry.

## 2.1.0 — 2026-09-14

Quality-bar pass (WP-M2-1). No guard's decision logic changed — this closes
coverage, versioning, and drift-detection gaps around the existing hooks.

- Versioned 6 live Claude Code hook scripts that `policy/claude-settings.json`
  already references but the kit did not ship: `session-budget.sh`,
  `auto-format.sh`, `completion-guard.sh` (+ its `completion-guard.py`
  dependency), `config-protection.sh`, `fanout-pressure-guard.sh`,
  `path-guard.sh`. Also versioned `lib/git-policy-lib.sh`, the dependency
  `git-guard.sh` already shipped without.
- Added a `node:test` regression test for every one of those, plus for the
  two previously-untested already-shipped scripts (`git-guard.sh`,
  `auto-approve-reads.sh`) — each covers at least one allow and one
  block/nudge case, using temp `HOME`s and temp git repos only.
- Added `policy/runtimes.json` `interpreters` minimums (bash, python3, node,
  bun) and a `checkInterpreters()` step in `install-agent-workflows.mjs
  --check` that verifies them before anything else, read-only.
- Regenerated `manifest.json` for the new files.
- Repointed the freshness async-hook path in `policy/claude-settings.json`
  from the retired brain location to its current one.
- This VERSION file and this changelog.

## 2.0 (unversioned baseline)

Prior history is `git log` on `.config/agent-workflows/` — no VERSION file
existed before this entry; manifest `"version": 2` refers to the manifest
schema, not the kit release.
