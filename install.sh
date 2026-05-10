#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*"; }
err() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

backup_path() {
  local path="$1"
  local rel
  rel="${path#$HOME/}"
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  mv "$path" "$BACKUP_DIR/$rel"
  log "Backup: $path -> $BACKUP_DIR/$rel"
}

link_path() {
  local src="$1"
  local dest="$2"

  if [[ ! -e "$src" ]]; then
    warn "No existe fuente: $src"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"

  if [[ -L "$dest" ]]; then
    local current
    current="$(readlink "$dest")"
    if [[ "$current" == "$src" ]]; then
      log "OK symlink: $dest"
      return 0
    fi
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    backup_path "$dest"
  fi

  ln -s "$src" "$dest"
  log "Link: $dest -> $src"
}

install_apt_packages() {
  if [[ ! -f /etc/os-release ]]; then
    warn "No puedo detectar distro; salto apt packages."
    return 0
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    warn "Este installer inicial solo instala paquetes en Ubuntu. Distro detectada: ${ID:-unknown}"
    return 0
  fi

  log "Ubuntu detectado: ${PRETTY_NAME:-ubuntu}"
  sudo apt-get update

  local core=(
    ca-certificates
    curl
    wget
    unzip
    git
    zsh
    tmux
    ripgrep
    fd-find
    xclip
    wl-clipboard
    nnn
    build-essential
    python3
  )

  sudo apt-get install -y "${core[@]}"

  # Paquetes buenos si existen en el repo habilitado.
  local optional=(gh zoxide)
  local pkg
  for pkg in "${optional[@]}"; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
      sudo apt-get install -y "$pkg"
    else
      warn "Paquete no disponible en apt: $pkg"
    fi
  done
}

install_neovim_latest() {
  # Tu config usa APIs modernas de Neovim; Ubuntu 22.04 trae una versión vieja.
  if need_cmd nvim; then
    local minor
    minor="$(nvim --version | head -n1 | sed -E 's/.*NVIM v[0-9]+\.([0-9]+).*/\1/')"
    if [[ "$minor" =~ ^[0-9]+$ ]] && (( minor >= 11 )); then
      log "Neovim moderno ya instalado: $(nvim --version | head -n1)"
      return 0
    fi
    warn "Neovim actual parece viejo: $(nvim --version | head -n1). Instalo release moderna en ~/.local."
  fi

  if [[ "$(uname -m)" != "x86_64" ]]; then
    warn "Arquitectura no soportada para install automático de Neovim: $(uname -m)"
    return 0
  fi

  mkdir -p "$HOME/.local/bin" "$HOME/.local/opt"
  local url="https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/nvim.tar.gz"
  rm -rf "$HOME/.local/opt/nvim-linux-x86_64"
  tar -xzf "$tmp/nvim.tar.gz" -C "$HOME/.local/opt"
  ln -sfn "$HOME/.local/opt/nvim-linux-x86_64/bin/nvim" "$HOME/.local/bin/nvim"
  rm -rf "$tmp"
  log "Neovim instalado: $HOME/.local/bin/nvim"
}

setup_fd() {
  mkdir -p "$HOME/.local/bin"
  if ! need_cmd fd && need_cmd fdfind; then
    ln -sfn "$(command -v fdfind)" "$HOME/.local/bin/fd"
    log "Link: ~/.local/bin/fd -> $(command -v fdfind)"
  fi
}

install_fzf_latest() {
  if [[ ! -d "$HOME/.fzf/.git" ]]; then
    rm -rf "$HOME/.fzf"
    git clone --depth 1 https://github.com/junegunn/fzf.git "$HOME/.fzf"
    log "fzf clonado en $HOME/.fzf"
  else
    git -C "$HOME/.fzf" pull --ff-only || warn "No pude actualizar fzf en $HOME/.fzf"
  fi

  "$HOME/.fzf/install" --all

  # Ubuntu 22.04 trae fzf viejo en /usr/bin sin --tmux.
  # Forzamos que ~/.local/bin gane en PATH y apunte al fzf recién instalado.
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$HOME/.fzf/bin/fzf" "$HOME/.local/bin/fzf"
  export PATH="$HOME/.local/bin:$PATH"
  hash -r 2>/dev/null || true

  log "fzf instalado desde git: $($HOME/.local/bin/fzf --version)"
}

patch_pi_shebang() {
  if ! need_cmd pi; then
    return 0
  fi

  local pi_bin first_line
  pi_bin="$(readlink -f "$(command -v pi)")"

  if [[ ! -f "$pi_bin" || ! -w "$pi_bin" ]]; then
    warn "No puedo modificar shebang de pi: $pi_bin"
    return 0
  fi

  first_line="$(head -n 1 "$pi_bin")"
  if [[ "$first_line" == "#!/usr/bin/env node" ]]; then
    sed -i '1s|^#!/usr/bin/env node$|#!/usr/bin/env bun|' "$pi_bin"
    log "Patch pi shebang: $pi_bin -> bun"
  else
    log "Pi shebang OK: $first_line"
  fi
}

install_bun_and_pi() {
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"

  if ! need_cmd bun; then
    log "Instalando Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$BUN_INSTALL/bin:$PATH"
  else
    log "Bun ya instalado: $(command -v bun)"
  fi

  if ! need_cmd pi; then
    log "Instalando Pi agent..."
    bun add -g @earendil-works/pi-coding-agent
  else
    log "Pi agent ya instalado: $(command -v pi)"
  fi

  patch_pi_shebang
}

install_tpm() {
  local tpm_dir="$HOME/.tmux/plugins/tpm"
  if [[ ! -d "$tpm_dir" ]]; then
    mkdir -p "$(dirname "$tpm_dir")"
    git clone https://github.com/tmux-plugins/tpm "$tpm_dir"
    log "TPM instalado en $tpm_dir"
  else
    log "TPM ya existe: $tpm_dir"
  fi

  if [[ -x "$tpm_dir/bin/install_plugins" ]]; then
    "$tpm_dir/bin/install_plugins" || warn "No pude instalar plugins de tmux automáticamente. Usa prefix + I dentro de tmux."
  fi
}

install_pi_extensions() {
  if ! need_cmd pi; then
    warn "pi no disponible; salto instalación de extensiones."
    return 0
  fi

  local ext
  for ext in \
    "$DOTFILES_DIR/pi/extensions/pi-powerline-footer" \
    "$DOTFILES_DIR/pi/extensions/pi-mcp-adapter" \
    "$DOTFILES_DIR/pi/extensions/pi-vim-editor"
  do
    if [[ -d "$ext" ]]; then
      log "Instalando extensión Pi: $ext"
      pi install "$ext" || warn "Falló instalación de extensión: $ext"
    fi
  done
}

install_zim() {
  if need_cmd zsh; then
    log "Instalando/actualizando módulos Zim..."
    zsh -ic 'zimfw install' || warn "Zim no terminó correctamente; abre zsh y revisa mensajes."
  fi
}

change_shell_hint() {
  if need_cmd zsh && [[ "${SHELL:-}" != "$(command -v zsh)" ]]; then
    warn "Tu shell actual es ${SHELL:-unknown}. Si quieres usar zsh por defecto ejecuta: chsh -s $(command -v zsh)"
  fi
}

healthcheck() {
  log "Healthcheck"
  local cmds=(zsh tmux nvim git fzf rg fd nnn bun pi)
  local c
  for c in "${cmds[@]}"; do
    if need_cmd "$c"; then
      printf '  [ok]   %-6s %s\n' "$c" "$(command -v "$c")"
    else
      printf '  [miss] %-6s\n' "$c"
    fi
  done
}

main() {
  log "Dotfiles: $DOTFILES_DIR"
  log "Home: $HOME"

  install_apt_packages
  install_neovim_latest
  setup_fd
  install_fzf_latest

  log "Creando symlinks..."
  link_path "$DOTFILES_DIR/nvim" "$HOME/.config/nvim"
  link_path "$DOTFILES_DIR/tmux/.tmux.conf" "$HOME/.tmux.conf"
  link_path "$DOTFILES_DIR/zsh/.zshenv" "$HOME/.zshenv"
  link_path "$DOTFILES_DIR/zsh/.zshrc" "$HOME/.zshrc"
  link_path "$DOTFILES_DIR/zsh/.zimrc" "$HOME/.zimrc"
  link_path "$DOTFILES_DIR/zsh/config/zsh" "$HOME/.config/zsh"
  link_path "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"

  # Pi mezcla config con estado local/auth/sesiones. No linkear ~/.pi/agent completo.
  if [[ -L "$HOME/.pi/agent" ]]; then
    rm "$HOME/.pi/agent"
  fi
  mkdir -p "$HOME/.pi/agent"
  link_path "$DOTFILES_DIR/pi/agent/settings.json" "$HOME/.pi/agent/settings.json"
  link_path "$DOTFILES_DIR/pi/agent/keybindings.json" "$HOME/.pi/agent/keybindings.json"
  link_path "$DOTFILES_DIR/pi/agent/models.json" "$HOME/.pi/agent/models.json"
  link_path "$DOTFILES_DIR/pi/agent/mcp.json" "$HOME/.pi/agent/mcp.json"
  link_path "$DOTFILES_DIR/pi/agent/extensions" "$HOME/.pi/agent/extensions"

  # Las extensiones locales viven en dotfiles/pi/extensions y se instalan con `pi install <ruta>`.
  # No se linkea ~/.pi/extensions porque Pi usa esa carpeta para paquetes instalados/estado local.
  if [[ -L "$HOME/.pi/extensions" ]]; then
    rm "$HOME/.pi/extensions"
    log "Eliminado symlink viejo: $HOME/.pi/extensions"
  fi

  link_path "$DOTFILES_DIR/nnn" "$HOME/.config/nnn"

  install_bun_and_pi
  install_pi_extensions
  install_tpm
  install_zim
  change_shell_hint
  healthcheck

  log "Listo. Si hubo backups están en: $BACKUP_DIR"
}

main "$@"
