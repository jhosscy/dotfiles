# ── fzf image finder (ALT-I) ──────────────────────────────
# Busca solo imágenes y las previsualiza con fzf-preview.sh
# Requires: fd, chafa, fzf >= 0.42 (sixel)

# Comando para listar imágenes (fd es más rápido que find)
export FZF_IMAGE_COMMAND="command fd -H --no-ignore-vcs -E .git \
  -e jpg -e jpeg -e png -e gif -e webp -e svg -e bmp \
  -e ico -e avif -e heic -e tiff -e jxl -e qoi ."

fzf-image-widget() {
  setopt localoptions pipefail no_aliases 2>/dev/null
  local item
  item=$(FZF_DEFAULT_COMMAND="${FZF_IMAGE_COMMAND}" \
    FZF_DEFAULT_OPTS="
      --height 100%
      --layout reverse
      --prompt '  🖼 '
      --preview-window down:99%:wrap
      --preview '/usr/share/fzf/fzf-preview.sh {}'
      --bind '?:toggle-preview'
      --bind 'ctrl-/:toggle-preview'
      --bind 'ctrl-alt-j:preview-down'
      --bind 'ctrl-alt-k:preview-up'
      --header '?:preview  ctrl-alt-j/k:scroll preview  enter:insert path'
      --multi
    " \
    $(__fzfcmd) < /dev/tty)
  local ret=$?
  if [[ -n "$item" ]]; then
    LBUFFER="${LBUFFER}${(q)item}"
  fi
  zle reset-prompt
  return $ret
}

zle -N fzf-image-widget

# zsh-vi-mode sobreescribe los keybindings tras su init con lazy keybindings.
# Hay que registrar nuestros bindings DESPUÉS de que zvm aplique los suyos.
# Usamos zvm_define_widget (recomendado por zvm) + zvm_after_lazy_keybindings.
if (( ${+functions[zvm_define_widget]} )); then
  zvm_define_widget fzf-image-widget
  function zvm_after_lazy_keybindings() {
    bindkey -M emacs '\ei' fzf-image-widget
    bindkey -M viins '\ei' fzf-image-widget
    bindkey -M vicmd '\ei' fzf-image-widget
  }
else
  # Sin zvm, binding directo
  bindkey -M emacs '\ei' fzf-image-widget
  bindkey -M viins '\ei' fzf-image-widget
  bindkey -M vicmd '\ei' fzf-image-widget
fi
