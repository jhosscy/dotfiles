/**
 * Theme resolution for the powerline.
 *
 * Colors are resolved in order: user overrides (`powerline.colors` in
 * settings.json, loaded once per session start) → preset colors → defaults.
 *
 * Hex colors go through pi-tui's `parseColor()` and `theme.style()`, so the
 * terminal's color mode decides how they are rendered. Nothing here touches the
 * filesystem, so it is safe on the render path.
 */
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { parseColor } from "@earendil-works/pi-tui";
import type { ColorScheme, ColorValue, SemanticColor, ThemeLike } from "./types.js";

export interface PowerlineThemeConfig {
  colors?: unknown;
  icons?: unknown;
}

// Default color scheme (uses pi theme colors)
const DEFAULT_COLORS: Required<ColorScheme> = {
  model: "#d787af",
  path: "#00afaf",
  gitDirty: "warning",
  gitClean: "success",
  thinking: "thinkingOff",
  thinkingMinimal: "thinkingMinimal",
  thinkingLow: "thinkingLow",
  thinkingMedium: "thinkingMedium",
  context: "dim",
  contextWarn: "warning",
  contextError: "error",
  cost: "text",
  tokens: "muted",
  separator: "dim",
  border: "borderMuted",
};

// Rainbow colors for high thinking levels
const RAINBOW_COLORS = [
  "#b281d6", "#d787af", "#febc38", "#e4c00f",
  "#89d281", "#00afaf", "#178fb9", "#b281d6",
];

const warnedInvalidThemeColors = new Set<string>();

let userTheme: ColorScheme = {};
let iconOverrides: Record<string, string> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Install the user overrides read from settings.json at session start. Replaces
 * any previous overrides; pass nothing to fall back to the built-in defaults.
 */
export function setThemeOverrides(config: PowerlineThemeConfig | undefined): void {
  userTheme = sanitizeUserThemeOverrides(config?.colors);
  iconOverrides = sanitizeIconOverrides(config?.icons);
}

export function getIconOverrides(): Readonly<Record<string, string>> {
  return iconOverrides;
}

function sanitizeIconOverrides(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, icon] of Object.entries(value)) {
    if (typeof icon === "string") sanitized[key] = icon;
  }
  return sanitized;
}

function sanitizeUserThemeOverrides(value: unknown): ColorScheme {
  if (!isRecord(value)) return {};
  const sanitized: ColorScheme = {};
  for (const [key, rawColor] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_COLORS, key)) continue;
    if (typeof rawColor !== "string") continue;
    const color = rawColor.trim();
    if (!color) continue;
    sanitized[key as SemanticColor] = color as ColorValue;
  }
  return sanitized;
}

/**
 * Resolve a semantic color to an actual color value
 */
export function resolveColor(semantic: SemanticColor, presetColors?: ColorScheme): ColorValue {
  return userTheme[semantic] ?? presetColors?.[semantic] ?? DEFAULT_COLORS[semantic];
}

function isHexColor(color: ColorValue): color is `#${string}` {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Apply a color to text using the pi theme (token) or pi-tui's color pipeline
 * (hex), so the terminal's color capability is respected either way.
 */
export function applyColor(theme: ThemeLike, color: ColorValue, text: string): string {
  if (isHexColor(color)) {
    return theme.style(text, { fg: parseColor(color) });
  }
  try {
    return theme.fg(color as ThemeColor, text);
  } catch (error) {
    const key = String(color);
    if (!warnedInvalidThemeColors.has(key)) {
      warnedInvalidThemeColors.add(key);
      if (warnedInvalidThemeColors.size > 200) warnedInvalidThemeColors.clear();
      console.debug(`[powerline] Invalid theme color "${key}"; falling back to "text".`, error);
    }
    return theme.fg("text", text);
  }
}

/**
 * Apply a semantic color to text
 */
export function fg(
  theme: ThemeLike,
  semantic: SemanticColor,
  text: string,
  presetColors?: ColorScheme,
): string {
  return applyColor(theme, resolveColor(semantic, presetColors), text);
}

/**
 * Apply rainbow gradient to text (for high thinking levels). Each character is
 * styled through the theme so the terminal's color mode still applies.
 */
export function rainbow(theme: ThemeLike, text: string): string {
  let result = "";
  let colorIndex = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      const color = RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length] as ColorValue;
      result += applyColor(theme, color, char);
      colorIndex++;
    }
  }
  return result;
}

export function getDefaultColors(): Required<ColorScheme> {
  return { ...DEFAULT_COLORS };
}
