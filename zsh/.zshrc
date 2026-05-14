# Start configuration added by Zim install {{{
#
# User configuration sourced by interactive shells
#

# -----------------
# Zsh configuration
# -----------------

#
# History
#

# Remove older command from the history if a duplicate is to be added.
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_FIND_NO_DUPS

# fzf-history
setopt EXTENDED_HISTORY
setopt inc_append_history_time

#
# Input/output
#

# Set editor default keymap to emacs (`-e`) or vi (`-v`)
#bindkey -v

# Prompt for spelling correction of commands.
#setopt CORRECT

# Customize spelling correction prompt.
#SPROMPT='zsh: correct %F{red}%R%f to %F{green}%r%f [nyae]? '

# Remove path separator from WORDCHARS.
WORDCHARS=${WORDCHARS//[\/]}

# -----------------
# Zim configuration
# -----------------

# Use degit instead of git as the default tool to install and update modules.
#zstyle ':zim:zmodule' use 'degit'

# --------------------
# Module configuration
# --------------------

#
# git
#

# Set a custom prefix for the generated aliases. The default prefix is 'G'.
#zstyle ':zim:git' aliases-prefix 'g'

#
# input
#

# Append `../` to your input for each `.` you type after an initial `..`
#zstyle ':zim:input' double-dot-expand yes

#
# termtitle
#

# Set a custom terminal title format using prompt expansion escape sequences.
# See http://zsh.sourceforge.net/Doc/Release/Prompt-Expansion.html#Simple-Prompt-Escapes
# If none is provided, the default '%n@%m: %~' is used.
#zstyle ':zim:termtitle' format '%1~'

#
# zsh-autosuggestions
#

# Disable automatic widget re-binding on each precmd. This can be set when
# zsh-users/zsh-autosuggestions is the last module in your ~/.zimrc.
# ZSH_AUTOSUGGEST_MANUAL_REBIND=1

# Customize the style that the suggestions are shown with.
# See https://github.com/zsh-users/zsh-autosuggestions/blob/master/README.md#suggestion-highlight-style
#ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=242'

#
# zsh-syntax-highlighting
#

# Set what highlighters will be used.
# See https://github.com/zsh-users/zsh-syntax-highlighting/blob/master/docs/highlighters.md
# ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)

# Customize the main highlighter styles.
# See https://github.com/zsh-users/zsh-syntax-highlighting/blob/master/docs/highlighters/main.md#how-to-tweak-it
#typeset -A ZSH_HIGHLIGHT_STYLES
#ZSH_HIGHLIGHT_STYLES[comment]='fg=242'

# config zsh-vi-mode
ZVM_INIT_MODE=sourcing
ZVM_SYSTEM_CLIPBOARD_ENABLED=true
ZVM_VI_INSERT_ESCAPE_BINDKEY=ii


# editor
export EDITOR=nvim
export PAGER=less

# ── fzf global: preview scroll ────────────────────────────
export FZF_DEFAULT_OPTS="$FZF_DEFAULT_OPTS \
  --tmux center,85%,85% \
  --layout reverse \
  --info inline-right \
  --border top \
  --prompt ' ∷ ' \
  --preview-window down:99%:hidden:wrap \
  --bind '?:toggle-preview' \
  --bind 'ctrl-/:toggle-preview' \
  --bind ctrl-alt-j:preview-down \
  --bind ctrl-alt-k:preview-up
"

# ── CTRL-R history search ─────────────────────────────────
export FZF_CTRL_R_OPTS="
  --header 'ctrl-y:copy  ctrl-r:sort  ctrl-e:edit  ?:preview  ctrl-alt-j/k:preview'
  --preview 'echo {}'
  --bind 'ctrl-y:execute-silent(echo -n {2..} | pbcopy)+abort'
  --bind 'ctrl-e:execute(echo {2..} | vipe | bash)'
"

# ------------------
# Initialize modules
# ------------------

ZIM_HOME=${ZDOTDIR:-${HOME}}/.zim
# Download zimfw plugin manager if missing.
if [[ ! -e ${ZIM_HOME}/zimfw.zsh ]]; then
  if (( ${+commands[curl]} )); then
    curl -fsSL --create-dirs -o ${ZIM_HOME}/zimfw.zsh \
        https://github.com/zimfw/zimfw/releases/latest/download/zimfw.zsh
  else
    mkdir -p ${ZIM_HOME} && wget -nv -O ${ZIM_HOME}/zimfw.zsh \
        https://github.com/zimfw/zimfw/releases/latest/download/zimfw.zsh
  fi
fi
# Install missing modules, and update ${ZIM_HOME}/init.zsh if missing or outdated.
if [[ ! ${ZIM_HOME}/init.zsh -nt ${ZIM_CONFIG_FILE:-${ZDOTDIR:-${HOME}}/.zimrc} ]]; then
  source ${ZIM_HOME}/zimfw.zsh init
fi
# Initialize modules.
source ${ZIM_HOME}/init.zsh

# ------------------------------
# Post-init module configuration
# ------------------------------

#
# zsh-history-substring-search
#

#zmodload -F zsh/terminfo +p:terminfo
# Bind ^[[A/^[[B manually so up/down works both before and after zle-line-init
#for key ('^[[A' '^P' ${terminfo[kcuu1]}) bindkey ${key} history-substring-search-up
#for key ('^[[B' '^N' ${terminfo[kcud1]}) bindkey ${key} history-substring-search-down
#for key ('k') bindkey -M vicmd ${key} history-substring-search-up
#for key ('j') bindkey -M vicmd ${key} history-substring-search-down
#unset key
# }}} End configuration added by Zim install

# ------------------------------
# Custom configuration
# ------------------------------

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# local bin
export PATH="$HOME/.local/bin:$PATH"

# NNN plugins
export NNN_TERMINAL=foot
export NNN_PLUG='p:preview-tui;o:fzplug;s:suedit'
export NNN_FIFO=/tmp/nnn.fifo      # FIFO necesario para la vista previa
export NNN_SPLIT=v

# pi powerline
export POWERLINE_NERD_FONTS=1

# fzf image finder (ALT-I)
[[ -f ~/.config/zsh/fzf-image.zsh ]] && source ~/.config/zsh/fzf-image.zsh

# apikeys
[[ -f ~/.config/zsh/api-keys.zsh ]] && source ~/.config/zsh/api-keys.zsh

# zoxide
eval "$(zoxide init zsh)"
