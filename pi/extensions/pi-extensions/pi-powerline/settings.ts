/**
 * Powerline settings, read once per session start.
 *
 * `<agent-dir>/settings.json` (honours `PI_CODING_AGENT_DIR`) merged with the
 * project's `.pi/settings.json`, under the `powerline` key. Nothing here is read
 * from the render path.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { StatusLinePreset } from "./types.js";

export interface PowerlineSettings {
  preset?: unknown;
  segmentOptions?: unknown;
  options?: unknown;
  customItems?: unknown;
  colors?: unknown;
  icons?: unknown;
}

export interface PowerlineConfigFile {
  powerline?: PowerlineSettings | string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getGlobalSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function readSettingsFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline] Ignoring non-object settings at ${path}`);
      return {};
    }
    return parsed;
  } catch (error) {
    console.debug(`[powerline] Failed to read settings from ${path}:`, error);
    return {};
  }
}

function mergeSettings(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(overrideValue)
      ? mergeSettings(baseValue, overrideValue)
      : overrideValue;
  }
  return merged;
}

export function readSettings(cwd: string): Record<string, unknown> {
  return mergeSettings(
    readSettingsFile(getGlobalSettingsPath()),
    readSettingsFile(getProjectSettingsPath(cwd)),
  );
}

/**
 * Persist a preset, writing to the project settings file when that file already
 * owns the `powerline` key and to the global file otherwise.
 */
export function writePresetSetting(preset: StatusLinePreset, cwd: string): boolean {
  const globalPath = getGlobalSettingsPath();
  const projectPath = getProjectSettingsPath(cwd);
  const globalSettings = readSettingsFile(globalPath);
  const projectSettings = readSettingsFile(projectPath);
  const writeToProject = Object.prototype.hasOwnProperty.call(projectSettings, "powerline");
  const path = writeToProject ? projectPath : globalPath;
  const settings = writeToProject ? projectSettings : globalSettings;
  const existing = settings.powerline;
  settings.powerline = isRecord(existing) ? { ...existing, preset } : preset;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
    return true;
  } catch (error) {
    console.debug(`[powerline] Failed to persist preset to ${path}:`, error);
    return false;
  }
}
