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
