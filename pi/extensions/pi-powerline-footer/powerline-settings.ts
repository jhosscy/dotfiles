import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { StatusLinePreset } from "./types.js";
import { nextPowerlineSettingWithPreset } from "./powerline-config.js";

export interface PowerlineShortcuts {
  stashHistory: string;
  copyEditor: string;
  cutEditor: string;
}

type PowerlineShortcutKey = keyof PowerlineShortcuts;

const DEFAULT_SHORTCUTS: PowerlineShortcuts = {
  stashHistory: "ctrl+alt+h",
  copyEditor: "ctrl+alt+c",
  cutEditor: "ctrl+alt+x",
};
const SHORTCUT_KEYS: PowerlineShortcutKey[] = ["stashHistory", "copyEditor", "cutEditor"];
const RESERVED_SHORTCUTS = new Set(["alt+s"]);
const SHORTCUT_MODIFIERS = new Set(["ctrl", "alt", "shift"]);
const SHORTCUT_NAMED_KEYS = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageup", "pagedown", "up", "down", "left", "right",
]);
const SHORTCUT_SYMBOL_KEYS = new Set([
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "|", "~", "{", "}", ":", "<", ">", "?",
]);

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSettingsPath(): string {
  return join(homeDir(), ".pi", "agent", "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function getGlobalCompactionPolicyPath(): string {
  return join(homeDir(), ".pi", "agent", "compaction-policy.json");
}

export function getCustomCompactionExtensionPath(): string {
  return join(homeDir(), ".pi", "agent", "extensions", "pi-custom-compaction");
}

export function getStashHistoryPath(): string {
  return join(homeDir(), ".pi", "agent", "powerline-footer", "stash-history.json");
}

export function getSessionsPath(): string {
  return join(homeDir(), ".pi", "agent", "sessions");
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(overrideValue)
      ? mergeSettings(baseValue, overrideValue)
      : overrideValue;
  }
  return merged;
}

function readSettingsFile(settingsPath: string): Record<string, unknown> {
  try {
    if (!existsSync(settingsPath)) return {};
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }
    return parsed;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readWritableSettingsFile(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Refusing to write settings to non-object file at ${settingsPath}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to parse settings at ${settingsPath}:`, error);
    return null;
  }
}

export function readSettings(cwd: string = process.cwd()): Record<string, unknown> {
  return mergeSettings(readSettingsFile(getSettingsPath()), readSettingsFile(getProjectSettingsPath(cwd)));
}

export function writePowerlinePresetSetting(preset: StatusLinePreset, cwd: string = process.cwd()): boolean {
  const globalSettingsPath = getSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const globalSettings = readWritableSettingsFile(globalSettingsPath);
  const projectSettings = readWritableSettingsFile(projectSettingsPath);
  if (globalSettings === null || projectSettings === null) return false;

  const writeToProject = Object.prototype.hasOwnProperty.call(projectSettings, "powerline");
  const settingsPath = writeToProject ? projectSettingsPath : globalSettingsPath;
  const settings = writeToProject ? projectSettings : globalSettings;
  settings.powerline = nextPowerlineSettingWithPreset(settings.powerline, preset);

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to persist preset to ${settingsPath}:`, error);
    return false;
  }
}

function readCompactionPolicyEnabled(configPath: string): boolean | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.enabled !== "boolean") return false;
    return parsed.enabled;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read compaction policy from ${configPath}:`, error);
    return false;
  }
}

export function detectCustomCompactionEnabled(cwd: string): boolean {
  if (!existsSync(getCustomCompactionExtensionPath())) return false;
  const projectSetting = readCompactionPolicyEnabled(join(cwd, ".pi", "compaction-policy.json"));
  if (projectSetting !== undefined) return projectSetting;
  return readCompactionPolicyEnabled(getGlobalCompactionPolicyPath()) ?? false;
}

function normalizeShortcut(value: string): string {
  return value.trim().toLowerCase();
}

function isValidShortcutKeyPart(keyPart: string): boolean {
  const lowerKeyPart = keyPart.toLowerCase();
  if (/^[a-z0-9]$/i.test(keyPart)) return true;
  if (/^f([1-9]|1[0-2])$/i.test(keyPart)) return true;
  if (SHORTCUT_NAMED_KEYS.has(lowerKeyPart)) return true;
  return SHORTCUT_SYMBOL_KEYS.has(keyPart);
}

function parseShortcutOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const parts = trimmed.split("+");
  if (parts.some((part) => part.length === 0)) return null;

  const modifierParts = parts.slice(0, -1).map((part) => part.toLowerCase());
  if (new Set(modifierParts).size !== modifierParts.length) return null;
  for (const modifier of modifierParts) {
    if (!SHORTCUT_MODIFIERS.has(modifier)) return null;
  }

  const keyPart = parts[parts.length - 1];
  if (!isValidShortcutKeyPart(keyPart)) return null;
  const normalizedKey = SHORTCUT_SYMBOL_KEYS.has(keyPart) ? keyPart : keyPart.toLowerCase();
  return [...modifierParts, normalizedKey].join("+");
}

function findShortcutReplacement(key: PowerlineShortcutKey, used: Set<string>): string | null {
  const preferred = DEFAULT_SHORTCUTS[key];
  if (!used.has(normalizeShortcut(preferred))) return preferred;
  for (const shortcutKey of SHORTCUT_KEYS) {
    const candidate = DEFAULT_SHORTCUTS[shortcutKey];
    if (!used.has(normalizeShortcut(candidate))) return candidate;
  }
  return null;
}

export function resolveShortcutConfig(settings: Record<string, unknown>): PowerlineShortcuts {
  const resolved: PowerlineShortcuts = { ...DEFAULT_SHORTCUTS };
  const shortcutSettings = settings.powerlineShortcuts;
  if (isRecord(shortcutSettings)) {
    for (const key of SHORTCUT_KEYS) {
      const override = parseShortcutOverride(shortcutSettings[key]);
      if (override) resolved[key] = override;
    }
  }

  const used = new Set<string>([...RESERVED_SHORTCUTS]);
  for (const key of SHORTCUT_KEYS) {
    const configured = resolved[key];
    const normalizedConfigured = normalizeShortcut(configured);
    if (!used.has(normalizedConfigured)) {
      used.add(normalizedConfigured);
      continue;
    }

    const replacement = findShortcutReplacement(key, used);
    if (!replacement) {
      console.debug(`[powerline-footer] Shortcut conflict for ${key}: "${configured}" is already in use`);
      continue;
    }
    console.debug(`[powerline-footer] Shortcut conflict for ${key}: "${configured}" replaced with "${replacement}"`);
    resolved[key] = replacement;
    used.add(normalizeShortcut(replacement));
  }
  return resolved;
}
