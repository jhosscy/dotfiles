# pi-extensions-bundle

Unified bundle of [pi coding agent](https://pi.dev) extensions. Single `index.ts` entrypoint for faster startup.

## Why bundle?

pi's native extension loader processes each extension file sequentially:

```typescript
// pi's loader (sequential)
for (const extPath of paths) {
    const { extension } = await loadExtension(extPath, ...);  // ← one at a time
}
```

With many extensions, this adds up:
- N × jiti transpilation overhead
- N × module resolution
- N × factory execution (sequential)

This bundle:
- **1** jiti transpilation (the `index.ts`)
- Sub-extensions loaded via Node/Bun's import system (cached)
- Factories run in **parallel** via `Promise.all`

## Structure

```
pi-extensions/
├── package.json          # Single manifest with all deps
├── index.ts              # Entrypoint that imports all extensions
├── pi-bash-mode/         # Individual extension folders
├── pi-budget-limiter/
├── pi-commandcode-provider/
├── pi-contree/
├── pi-cto-provider/
├── pi-powerline-footer/
├── pi-screenshots-picker/
├── pi-ssh-remote/
├── pi-tts/
└── pi-vim-editor/
```

## Setup

```bash
cd /home/jhosscy/desk/projects/dev-tools/pi-extensions
npm install
```

## Install in pi

```bash
# Remove old individual packages
pi remove /home/jhosscy/desk/projects/dev-tools/pi-extensions/pi-powerline-footer
pi remove /home/jhosscy/desk/projects/dev-tools/pi-extensions/pi-vim-editor
pi remove /home/jhosscy/desk/projects/dev-tools/pi-extensions/pi-commandcode-provider
pi remove /home/jhosscy/desk/projects/dev-tools/pi-extensions/pi-cto-provider

# Install the bundle
pi install /home/jhosscy/desk/projects/dev-tools/pi-extensions
```

## Enable/Disable extensions

Edit `index.ts` and toggle the `enabled` flag:

```typescript
{
    name: "vim-editor",
    factory: vimEditor,
    enabled: true,  // ← change to false to disable
    phase: "ui",
},
```

## Phases

Extensions are loaded in two phases to respect dependencies:

1. **Provider phase** — Extensions that register custom model providers (async). These must complete before the model registry is used.
2. **UI phase** — UI/TUI/editor extensions (mostly sync, but awaited for safety).

Each phase loads its extensions in **parallel** via `Promise.all`.

## Adding a new extension

1. Drop the extension folder into this directory
2. Add the import at the top of `index.ts`
3. Add an entry to the `EXTENSIONS` array
4. Run `npm install` if it has dependencies
5. Set `enabled: true`
