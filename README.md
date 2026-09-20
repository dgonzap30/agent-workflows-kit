# dotfiles

A portable agent-workflow kit plus the Mac shell, terminal, prompt and package
setup around it. Machine-specific files ship as `.example` siblings; copy the
one you need and keep your real version untracked.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## What's in here

```
.config/
  agent-workflows/     Versioned Codex + Claude Code long-run protocol and integrity manifest
  claude-plugin-profiles/  Project/local activation policy for heavyweight Claude plugins
  codex-profiles/      Bounded additive Codex profiles and catalog-switch tests
  ghostty/config      Terminal: Monaspace + true black + signature magenta cursor
  starship.toml       Prompt config
.ssh/
  config.example      SSH host config — REDACTED. Real one stays out of git.
.zshrc                Shell config
.local/bin/install-agent-workflows.mjs  Drift-safe cross-runtime installer/checker
.local/bin/codex-catalog.mjs            Atomic single-bundle Codex catalog switcher
Brewfile              Homebrew formulas, casks, and taps (regenerate via `brew bundle dump --force`)
.gitignore            Excludes real .ssh/config, keys, OS cruft
```

## Restoring on a new Mac

```bash
# 1. Clone
git clone <repo-url> ~/dotfiles

# 2. Install Homebrew if needed, then everything else
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
cd ~/dotfiles && brew bundle install --file=./Brewfile

# 3. Symlink configs
mkdir -p ~/.config/ghostty
ln -sf ~/dotfiles/.config/ghostty/config ~/.config/ghostty/config
ln -sf ~/dotfiles/.config/starship.toml ~/.config/starship.toml
ln -sf ~/dotfiles/.zshrc ~/.zshrc

# Restore the generated Claude/Codex policy, managed Claude settings, confirmed
# stale Codex trust cleanup, long-run protocol, compact prompt hook, profiles,
# and CLI links, and writes an owner-only rollback bundle.
#
# On a machine with no existing globals, this is the whole install:
node ~/dotfiles/.local/bin/install-agent-workflows.mjs --install --adapter portable
node ~/dotfiles/.local/bin/install-agent-workflows.mjs --check

# --adopt is only needed when the managed files already exist and you are
# taking them over without verification. The installer names them if so.
# Keep --adapter portable here too: without it you get the desktop adapter,
# which rewrites hooks a fresh machine does not have.
node ~/dotfiles/.local/bin/install-agent-workflows.mjs --install --adopt --adapter portable

# Later source updates do not need --adopt; drift is rejected instead of overwritten.
node ~/dotfiles/.local/bin/install-agent-workflows.mjs --install

# Desktop hosts only — the portable adapter does not link these two commands.
codex-catalog status
agent-catalog-check

# To undo the last install, use the exact bundle printed by --install. Restore
# refuses to run if any managed target changed after that install.
node ~/dotfiles/.local/bin/install-agent-workflows.mjs --restore \
  ~/.config/agent-workflows/backups/<bundle>

# 4. SSH — copy + un-redact manually (don't symlink the example)
cp ~/dotfiles/.ssh/config.example ~/.ssh/config
$EDITOR ~/.ssh/config  # replace <REDACTED-*> placeholders
chmod 600 ~/.ssh/config

# 5. Generate keys if you don't have them
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "$(whoami)@$(hostname)"
# Add to agent + Keychain
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

## Updating

After tweaking a real config, sync it back:

```bash
# Generic
cp ~/.zshrc ~/dotfiles/.zshrc
cp ~/.config/ghostty/config ~/dotfiles/.config/ghostty/config
cp ~/.config/starship.toml ~/dotfiles/.config/starship.toml

# Agent workflow source lives in this repository. Edit it here, refresh its
# manifest, run its tests, and use --check; do not copy live private globals in.

# Brewfile (captures everything currently installed)
cd ~/dotfiles && brew bundle dump --force --file=./Brewfile

# SSH config: edit .ssh/config.example by hand — never copy real config in
# (real one has Tailscale IPs and host aliases that should stay private)

git add -A
git commit -m "sync: <what changed>"
git push
```

## Machine-specific files

These are gitignored; each ships an `.example` you copy once:

| Yours (untracked) | Ships as |
|---|---|
| `.config/work/projects` | `projects.example` |
| `.config/agent-workflows/policy/claude-settings.json` | `claude-settings.example.json` |
| `.config/agent-workflows/policy/codex-config.json` | `codex-config.example.json` |
| `.config/agent-workflows/policy/owner.json` | absent by default — set `OWNER_LABEL`, `OWNER_SUFFIX` and `WORKSPACE_MAP_RULE` to put your own name and workspace map into the rendered instructions |
| `.config/codex-profiles/<name>.config.toml` | `<name>.config.toml.example` |
| `~/.zshrc.local` | sourced if present; keep per-host aliases there |

## Notes

- **`.ssh/config.example` is the only SSH file in the repo.** The real `~/.ssh/config` is gitignored. Same for any `id_*` keys.
- **`Brewfile` is regenerated, not handwritten.** `brew bundle dump --force` overwrites it with current state. Don't edit by hand.
- **Ghostty config is a literal copy, not a symlink target.** If you change Ghostty settings, copy the file back into the repo before committing.

## Workspace sessionizer (`work`)

One named zellij session per project — kills terminal pane sprawl. Front door: `work` (fzf
picker), `work <slug>` (jump), `work ls` (board), `work edit` (registry). Files: `.local/bin/work`,
`.config/work/projects.example`, `.config/zellij/{config.kdl,layouts/}`. Deps: zellij, fzf, zoxide.

Restore on a new Mac (after `brew bundle`):

```bash
mkdir -p ~/.config/zellij ~/.config/work ~/.local/bin
cp -R ~/dotfiles/.config/zellij/. ~/.config/zellij/
cp ~/dotfiles/.config/work/projects.example ~/.config/work/projects
cp ~/dotfiles/.local/bin/work ~/.local/bin/work && chmod +x ~/.local/bin/work
```


## Agent workflow policy: desktop and portable hosts

The source of truth is `.config/agent-workflows/` plus the installed catalog/installer commands. Live installations use a versioned release snapshot, not an editable checkout. Verify with `install-agent-workflows --check`; the command remembers whether the host uses the desktop or portable adapter.

The portable adapter is the one a fresh machine should use, and the only one
proven to install onto a host with no existing runtime settings; the desktop
adapter additionally rewrites hooks that such a host does not have yet. Only
`install-agent-workflows` is linked in portable mode — `codex-catalog` and
`agent-catalog-check` are desktop-only commands.

Desktop installs include scoped profiles, local skills, rules, and host-specific integrations. A new headless or server host uses `--adapter portable --install`: it receives self-contained policy/skills/rules and the installer, preserving its model, effort, plugin, and permission settings. Portable mode does not install desktop UI hooks or desktop path profiles. Adapter changes on an already managed host are deliberately refused; use a separately reviewed migration or restore its recorded state first.

Before a release: refresh the manifest for every managed source and linked profile/command, run the workflow/catalog test suites, commit named files, and create a read-only snapshot of that commit. Install it with the explicitly expected `--previous-source` when relocating existing links. The installer creates owner-only rollback bundles and refuses concurrent target drift. Do not copy a desktop user's config onto a headless host.

The main model defaults are deliberate user settings. Benchmark results may justify selectable presets; they do not authorize silently changing active work. Repository-derived evaluation data must have explicit approval for any external model destinations before submission.

### Kit version

`.config/agent-workflows/VERSION` is the kit's own semver, independent of `manifest.json`'s `"version": 2` (that number is the manifest *schema*, not a release). Changes are recorded in `.config/agent-workflows/CHANGELOG.md`. Bump VERSION and add a changelog entry whenever a release changes hook behavior, adds/removes a managed file, or changes the installer's `--check`/`--install` contract.

### Required interpreters

`.config/agent-workflows/policy/runtimes.json` pins minimum interpreter versions under its `interpreters` key (bash, python3, node, bun) — the versions the kit's hook scripts and installer are written against. `install-agent-workflows.mjs --check` verifies these first, before manifest hashes or settings validity, and fails with a named interpreter/version if one is missing or too old. This check never installs anything.

### `--check` mode

`node .local/bin/install-agent-workflows.mjs --check [--home <path>] [--source <path>]` is fully read-only: it verifies (1) required interpreters are on PATH and meet `runtimes.json`'s minimums, (2) every file the source manifest lists exists at the hash `manifest.json` records, (3) the source's managed-file inventory exactly matches the manifest (nothing added or removed without a manifest refresh), (4) the target's Claude settings and Codex config normalize to the same policy projection the last `--install` recorded (no drift), and (5) no managed symlink has been retargeted. It exits non-zero and names the first failure; it never writes to `--home`. Use `--source` to check a different checkout (e.g. a branch under review) against a `--home` you don't intend to touch.

### Claude Code hook inventory

`.config/agent-workflows/runtime/claude/` versions the Claude Code hook scripts that `policy/claude-settings.json` references by name (`replaceCommands`, `forbidCommands`, `asyncCommands`, `syncRequiredCommands`), each with a `node:test` regression test covering at least one allow and one block/nudge case:

| Script | Role |
|---|---|
| `prompt-gate.sh` (in `hooks/`, cross-runtime) | UserPromptSubmit — long-run lifecycle nudge |
| `auto-approve-reads.sh` | retired compatibility no-op; native permission engine now owns this |
| `session-budget.sh` | UserPromptSubmit — session-size/correction advisory (see below) |
| `auto-format.sh` | PostToolUse — Prettier on edited files when a local binary exists |
| `completion-guard.sh` (+ `completion-guard.py`) | Stop — flags claimed-but-unverified completions |
| `config-protection.sh` | PreToolUse — blocks self-edits to global Claude config |
| `fanout-pressure-guard.sh` | PreToolUse (Task/Agent/Workflow) — blocks new agent fan-out under swap pressure |
| `git-guard.sh` (+ `lib/git-policy-lib.sh`) | PreToolUse/Bash — blocks edits/commits on a protected branch |

`git-context.sh` and `stop-name-refresh.sh` are also versioned here even though `policy/claude-settings.json` doesn't name them directly — both are genuinely installer-managed via `policy/assets.json`, which copies them onto the live host on `--install`.

`git-guard.sh`'s kit copy differs from the live one by a single sanitized comment line (the maintainer name → `the owner`, part of this repo's owner-identity scrub) — cosmetic, not decision logic; the live script's actual behavior is unchanged from what's versioned here.

### Personal hook layer (`local/claude-hooks/`)

17 more scripts live at `~/.claude/scripts/hooks/` (plus `helm-emit.sh`,
which lives in the separate `helm` repo) but are genuinely host-local — not
referenced by `policy/claude-settings.json` or `policy/assets.json`, and not
generalizable kit behavior: `bash-shape-guard.sh`, `commit-quality.sh`,
`dev-server-block.sh`, `env-protection.sh`, `frozen-repo-guard.sh`,
`gh-repo-guard.sh`, `inject-stack-rules.sh`, `judge.py`,
`pre-compact-backup.sh`, `project-inventory-guard.sh`, `rules-probe.sh`,
`session-label.sh`, `session-name-gen.sh`, `session-reap.sh`,
`session-start-title.sh`, `task-completed-tsc.sh`, `helm-emit.sh`. These are
versioned byte-identical, each with a `node:test` regression test, in
`local/claude-hooks/` — the personal/local layer, tracked in git but outside
`.config/agent-workflows/` (the kit's `managedRoot`), so the installer never
walks or manages them and the `publish/agent-workflows-kit` export never
carries them. See `local/claude-hooks/README.md`. Run their tests with
`node --test local/claude-hooks/*.test.mjs`.

### `session-budget.sh` thresholds

UserPromptSubmit gate on session size. Always prints one unconditional hygiene line (`ps`-derived session count/RAM + `vm.swapusage` swap %); the budget tiers below are additional and conditional. All are env-overridable per session, never edited in place:

| Env var | Default | Meaning |
|---|---|---|
| `SESSION_BUDGET_OFF` | unset | any value disables the whole hook |
| `SESSION_BUDGET_SOFT_CTX` | `300000` | context tokens (input+cache) that trip the soft tier |
| `SESSION_BUDGET_HARD_CTX` | `600000` | context tokens that trip the hard (retire) tier |
| `SESSION_BUDGET_SOFT_MB` | `12` | transcript size (MB) that trips soft regardless of context |
| `SESSION_BUDGET_HARD_MB` | `25` | transcript size (MB) that trips hard regardless of context |
| `SESSION_BUDGET_MIN_MB` | `5` | minimum transcript size before the *context* thresholds count (avoids flagging one dense prompt) |
| `SESSION_BUDGET_CORR_WINDOW` | `12` | how many recent human turns are scanned for correction language |
| `SESSION_BUDGET_CORR_MIN` | `2` | correction hits in that window that trip the quality tier independently of size |

Slash-commands and bash-bangs (`prompt` starting with `/`, `#`, or `!`) skip the budget tiers entirely (only the hygiene line prints). Hard tier tells the model to retire via `/retire`; soft tier tells it to checkpoint, not split mid-task, and offers `/rewind` "Summarize from here" for a resolved detour. A hit is logged to `~/.claude/logs/session-budget.log`.
