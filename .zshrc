# --- ENVIRONMENT VARIABLES ---
export PATH="$HOME/bin:$HOME/.local/bin:/opt/homebrew/bin:$PATH"
export EDITOR="vim"
export SENTRY_DISABLE_AUTO_UPLOAD=true
export CLAUDE_CODE_NO_FLICKER=1
[ -f ~/.secrets/env ] && source ~/.secrets/env

# nvm setup
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # loads nvm bash_completion

# --- PLUGINS ---
# Syntax highlighting
if [ -f /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]; then
  source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi

# Command autosuggestions (ghosted gray text as you type)
if [ -f /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=#00FF66'

# Fuzzy finder (Ctrl+R, Ctrl+T, Alt+C)
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# Directory jumper (zoxide)
if command -v zoxide &>/dev/null; then
  eval "$(zoxide init zsh)"
fi

# Starship prompt (fancy git/node/python status line)
if command -v starship &>/dev/null; then
  eval "$(starship init zsh)"

  # Transient prompt: past prompts in scrollback collapse to a single green ❯
  function _transient_prompt_preexec() {
    PROMPT='%F{#00ff88}❯%f '
    zle && zle reset-prompt
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec _transient_prompt_preexec
fi

# Atuin — searchable SQLite-backed shell history (rebinds Ctrl+R, keeps up-arrow default)
if command -v atuin &>/dev/null; then
  eval "$(atuin init zsh --disable-up-arrow)"
fi

# iTerm2 shell integration (prompt marks, imgcat, session restoration)
test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"

# --- CLAUDE CODE ALIASES ---
alias claude-dev='claude --append-system-prompt "$(cat ~/.claude/contexts/dev.md)"'
alias claude-review='claude --append-system-prompt "$(cat ~/.claude/contexts/review.md)"'
alias claude-ai='claude --append-system-prompt "$(cat ~/.claude/contexts/ai-product.md)"'
alias claude-debug='claude --append-system-prompt "$(cat ~/.claude/contexts/debug.md)"'

# --- ALIASES ---
# Modern CLI replacements (aliases don't expand in scripts — safe)
alias ls='eza --icons --group-directories-first'
alias ll='eza -lah --icons --git --group-directories-first'
alias lt='eza --tree --icons --level=2'
alias cat='bat --paging=never --style=plain'
alias catp='bat'                # cat with pager + line numbers
alias cls="clear && echo -e '\033[0;32m$(toilet -f pagga --filter border BOOT COMPLETE)\033[0m'"
alias hgrep='history | grep -i'
alias update="brew update && brew upgrade && brew cleanup"
alias matrix='cmatrix -C green -u 4'

# --- COLORS ---
autoload -U colors && colors
setopt prompt_subst  # starship drives the prompt

# --- KEYBINDINGS ---
# Right arrow = accept autosuggestion
bindkey '^[[C' autosuggest-accept

# --- QUALITY OF LIFE ---
# Better history behavior
HISTSIZE=10000
SAVEHIST=10000
HISTFILE=~/.zsh_history
setopt INC_APPEND_HISTORY SHARE_HISTORY HIST_IGNORE_DUPS HIST_REDUCE_BLANKS

# Fast directory switching
setopt AUTO_CD


# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# --- DISK MANAGEMENT ---
# Quick cleanup: caches, Xcode build artifacts, Docker dangling
alias diskclean='echo "=== Before ===" && df -h / && echo "\n=== Cleaning ===" && npm cache clean --force 2>/dev/null && brew cleanup --prune=7 2>/dev/null && rm -rf ~/Library/Developer/Xcode/DerivedData/* 2>/dev/null && docker system prune -f 2>/dev/null && echo "\n=== After ===" && df -h /'

# Remove node_modules from projects not touched in 30+ days
alias nuke-modules='find ~/projects-and-tools -name "node_modules" -type d -prune -mtime +30 -exec echo "Removing: {}" \; -exec rm -rf {} +'

# Warn on shell startup if disk is over 85% full
_disk_pct=$(df -h / | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ "$_disk_pct" -gt 85 ] 2>/dev/null; then
  echo "\033[1;31m⚠  Disk is ${_disk_pct}% full. Run 'diskclean' or 'nuke-modules'.\033[0m"
fi
unset _disk_pct

# Added by Antigravity
export PATH="$HOME/.antigravity/antigravity/bin:$PATH"
export PATH=$PATH:$HOME/.maestro/bin

# Per-project and per-host shortcuts are machine-specific. Keep them in
# ~/.zshrc.local, which this file sources at the end and git ignores.
#   alias myproject="work myproject"
#   alias myhost="ssh myhost"

# --- WORK SESSIONIZER (canonical per-project zellij sessions) ---
# `work`         fuzzy-pick a project → its named zellij session (attach if live, else create)
# `work <slug>`  jump straight there   ·   `work ls`  the board   ·   `work edit`  the registry
# Escape hatch inside zellij: Ctrl+g locks it (keys pass to Claude); Ctrl+o d detaches.
alias wk='work'
#
# Optional — land every NEW Ghostty tab in the project picker (Esc in picker = plain shell).
# Guards: only Ghostty, only interactive, never when already inside zellij. Off switch: WORK_NO_AUTO=1.
# Uncomment the 3 lines to enable:
# if [[ -o interactive && -z $ZELLIJ && $TERM_PROGRAM == ghostty && -z $WORK_NO_AUTO ]]; then
#   work
# fi

# Machine-specific overrides, never tracked.
[ -f "$HOME/.zshrc.local" ] && source "$HOME/.zshrc.local"
