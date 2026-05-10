# pi-vim-editor

Standalone Vim-style modal editor extension for pi.

Install locally before editor-wrapping extensions such as `pi-bash-mode`:

```bash
pi install /home/jhosscy/desk/projects/dev-tools/pi-vim-editor
```

Enable it in settings:

```json
{
  "powerlineVimMode": true
}
```

Also accepts `vimMode: true` or `piVimMode: true`.

Supported behavior matches the former bundled Powerline Vim mode: `ii` switches from insert to normal mode; normal mode supports `h/j/k/l`, `w/b/e`, `0`, `$`, `^`, `gg/G`, `i/a/I/A/o/O`, `x/X`, `D/C`, `J`, `r`, `u`, `d/c/y` motions, and `p/P`. Press `v` for visual mode, then move and use `y`, `d`, or `c`.
