import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VimEditor } from "./vim-editor.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(value) ? mergeSettings(baseValue, value) : value;
  }
  return merged;
}

function readSettingsFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    console.debug(`[pi-vim-editor] Failed to read settings from ${path}:`, error);
    return {};
  }
}

function readSettings(cwd: string): Record<string, unknown> {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return mergeSettings(
    readSettingsFile(join(home, ".pi", "agent", "settings.json")),
    readSettingsFile(join(cwd, ".pi", "settings.json")),
  );
}

function isEnabled(settings: Record<string, unknown>): boolean {
  return settings.powerlineVimMode === true || settings.vimMode === true || settings.piVimMode === true;
}

export default function vimEditorExtension(pi: ExtensionAPI) {
  type EditorFactory = (tui: any, theme: any, keybindings: any) => any;
  let previousEditorFactory: EditorFactory | undefined;
  let vimEditorFactory: EditorFactory | undefined;

  function restore(ctx: any): void {
    if (typeof ctx.ui?.setEditorComponent === "function") {
      ctx.ui.setEditorComponent(previousEditorFactory);
    }
    previousEditorFactory = undefined;
    vimEditorFactory = undefined;
  }

  function install(ctx: any): void {
    // Compose with any previously installed custom editor so load order does not
    // matter. Capture the base factory immutably; reinstalling vim must never
    // make the vim factory wrap itself.
    const currentFactory = ctx.ui.getEditorComponent?.();
    if (currentFactory !== vimEditorFactory) {
      previousEditorFactory = currentFactory;
    }
    const baseEditorFactory = previousEditorFactory;

    const vimFactory: EditorFactory = (tui: any, theme: any, keybindings: any) =>
      new VimEditor(
        tui,
        theme,
        keybindings,
        baseEditorFactory
          ? baseEditorFactory(tui, theme, keybindings)
          : undefined,
      );

    vimEditorFactory = vimFactory;
    ctx.ui.setEditorComponent(vimFactory);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (isEnabled(readSettings(ctx.cwd))) install(ctx);
    else restore(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    restore(ctx);
  });
}