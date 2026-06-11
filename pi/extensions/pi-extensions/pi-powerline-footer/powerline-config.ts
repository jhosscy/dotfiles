import { visibleWidth } from "@earendil-works/pi-tui";
import type {
  ColorValue,
  CustomItemPosition,
  CustomStatusItem,
  PresetDef,
  StatusLinePreset,
  StatusLineSegmentId,
  StatusLineSegmentOptions,
} from "./types.ts";

export const GIT_POLLING_MODES = ["full", "branch", "off"] as const;
export type GitPollingMode = (typeof GIT_POLLING_MODES)[number];

export interface PowerlineConfig {
  preset: StatusLinePreset;
  customItems: CustomStatusItem[];
  segmentOptions: StatusLineSegmentOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreset(value: unknown, presets: readonly StatusLinePreset[]): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (presets as readonly string[]).includes(normalized) ? (normalized as StatusLinePreset) : null;
}

function normalizeCustomItemId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function normalizeCustomItemPosition(value: unknown): CustomItemPosition {
  if (value === "left" || value === "right" || value === "secondary") return value;
  return "right";
}

function normalizeCustomColor(value: unknown): ColorValue | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? (normalized as ColorValue) : undefined;
}

function normalizeCustomPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeCustomStatusItem(raw: unknown, idOverride?: string): CustomStatusItem | null {
  if (!isRecord(raw)) return null;
  const id = normalizeCustomItemId(idOverride ?? raw.id);
  if (!id) return null;

  const statusKey = typeof raw.statusKey === "string" && raw.statusKey.trim() ? raw.statusKey.trim() : id;

  return {
    id,
    statusKey,
    position: normalizeCustomItemPosition(raw.position),
    color: normalizeCustomColor(raw.color),
    prefix: normalizeCustomPrefix(raw.prefix),
    hideWhenMissing: raw.hideWhenMissing !== false,
    excludeFromExtensionStatuses: raw.excludeFromExtensionStatuses !== false,
  };
}

function normalizeCustomItems(raw: unknown): CustomStatusItem[] {
  const normalized: CustomStatusItem[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = normalizeCustomStatusItem(entry);
      if (item) normalized.push(item);
    }
  } else if (isRecord(raw)) {
    for (const [id, entry] of Object.entries(raw)) {
      const item = normalizeCustomStatusItem(entry, id);
      if (item) normalized.push(item);
    }
  }

  const deduped = new Map<string, CustomStatusItem>();
  for (const item of normalized) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()];
}

export function parsePowerlineConfig(value: unknown, presets: readonly StatusLinePreset[]): PowerlineConfig {
  const defaultConfig: PowerlineConfig = { preset: "default", customItems: [], segmentOptions: {} };

  const directPreset = normalizePreset(value, presets);
  if (directPreset) return { ...defaultConfig, preset: directPreset };

  if (!isRecord(value)) return defaultConfig;

  return {
    preset: normalizePreset(value.preset, presets) ?? defaultConfig.preset,
    customItems: normalizeCustomItems(value.customItems),
    segmentOptions: parseSegmentOptions(value.segmentOptions ?? value.options),
  };
}

export function mergeSegmentsWithCustomItems(presetDef: PresetDef, customItems: readonly CustomStatusItem[]): {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments: StatusLineSegmentId[];
} {
  const left: StatusLineSegmentId[] = [...presetDef.leftSegments];
  const right: StatusLineSegmentId[] = [...presetDef.rightSegments];
  const secondary: StatusLineSegmentId[] = [...(presetDef.secondarySegments ?? [])];

  for (const item of customItems) {
    const segmentId: StatusLineSegmentId = `custom:${item.id}`;
    if (item.position === "left") left.push(segmentId);
    else if (item.position === "secondary") secondary.push(segmentId);
    else right.push(segmentId);
  }

  return { leftSegments: left, rightSegments: right, secondarySegments: secondary };
}

export function nextPowerlineSettingWithPreset(existingPowerlineSetting: unknown, preset: StatusLinePreset): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return preset;
  }
  return { ...existingPowerlineSetting, preset };
}

export function collectHiddenExtensionStatusKeys(customItems: readonly CustomStatusItem[]): Set<string> {
  const hidden = new Set<string>();
  for (const item of customItems) {
    if (item.excludeFromExtensionStatuses) hidden.add(item.statusKey);
  }
  return hidden;
}

export function isNotificationExtensionStatus(value: string): boolean {
  return value.trimStart().startsWith("[");
}

export function getNotificationExtensionStatuses(
  statuses: ReadonlyMap<string, string>,
  hiddenKeys: ReadonlySet<string>,
): string[] {
  const notifications: string[] = [];
  for (const [statusKey, value] of statuses.entries()) {
    if (hiddenKeys.has(statusKey) || !value || !isNotificationExtensionStatus(value)) {
      continue;
    }
    notifications.push(value);
  }
  return notifications;
}

export function normalizeExtensionStatusValue(value: string): string | null {
  if (!value || visibleWidth(value) <= 0) {
    return null;
  }

  const stripped = value.replace(/(\x1b\[[0-9;]*m|\s|·|[|])+$/, "");
  return visibleWidth(stripped) > 0 ? stripped : null;
}

export function normalizeCompactExtensionStatus(value: string): string | null {
  if (isNotificationExtensionStatus(value)) {
    return null;
  }

  return normalizeExtensionStatusValue(value);
}

function normalizeGitPollingMode(value: unknown): GitPollingMode | undefined {
  if (typeof value !== "string") return undefined;
  return (GIT_POLLING_MODES as readonly string[]).includes(value)
    ? (value as GitPollingMode)
    : undefined;
}

function normalizeGitOptions(raw: unknown): StatusLineSegmentOptions["git"] | undefined {
  if (!isRecord(raw)) return undefined;

  const normalized: NonNullable<StatusLineSegmentOptions["git"]> = {};
  let touched = false;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "polling") {
      const mode = normalizeGitPollingMode(value);
      if (mode !== undefined) {
        (normalized as Record<string, unknown>).polling = mode;
        touched = true;
      }
      continue;
    }
    if (typeof value === "boolean") {
      (normalized as Record<string, unknown>)[key] = value;
      touched = true;
    }
  }

  return touched ? normalized : undefined;
}

function normalizeModelOptions(raw: unknown): StatusLineSegmentOptions["model"] | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.showThinkingLevel !== "boolean") return undefined;
  return { showThinkingLevel: raw.showThinkingLevel };
}

function normalizePathOptions(raw: unknown): StatusLineSegmentOptions["path"] | undefined {
  if (!isRecord(raw)) return undefined;
  const mode = raw.mode;
  const maxLength = raw.maxLength;
  const normalized: NonNullable<StatusLineSegmentOptions["path"]> = {};
  let touched = false;
  if (mode === "basename" || mode === "abbreviated" || mode === "full") {
    normalized.mode = mode;
    touched = true;
  }
  if (typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0) {
    normalized.maxLength = maxLength;
    touched = true;
  }
  return touched ? normalized : undefined;
}

function normalizeTimeOptions(raw: unknown): StatusLineSegmentOptions["time"] | undefined {
  if (!isRecord(raw)) return undefined;
  const format = raw.format;
  const showSeconds = raw.showSeconds;
  const normalized: NonNullable<StatusLineSegmentOptions["time"]> = {};
  let touched = false;
  if (format === "12h" || format === "24h") {
    normalized.format = format;
    touched = true;
  }
  if (typeof showSeconds === "boolean") {
    normalized.showSeconds = showSeconds;
    touched = true;
  }
  return touched ? normalized : undefined;
}

function normalizeTokensOptions(raw: unknown): StatusLineSegmentOptions["tokens"] | undefined {
  if (!isRecord(raw)) return undefined;
  const format = raw.format;
  const showUnitPrices = raw.showUnitPrices;
  const normalized: NonNullable<StatusLineSegmentOptions["tokens"]> = {};
  let touched = false;
  if (format === "exact" || format === "compact") {
    normalized.format = format;
    touched = true;
  }
  if (typeof showUnitPrices === "boolean") {
    normalized.showUnitPrices = showUnitPrices;
    touched = true;
  }
  return touched ? normalized : undefined;
}

function normalizeCostOptions(raw: unknown): StatusLineSegmentOptions["cost"] | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.mode !== "branch" && raw.mode !== "global") return undefined;
  return { mode: raw.mode };
}

/**
 * Parse user-supplied segment options from `settings.json`.
 *
 * Returns a partial object that can be merged on top of a preset's defaults.
 * Unknown keys are dropped, invalid values are ignored.
 */
export function parseSegmentOptions(value: unknown): StatusLineSegmentOptions {
  if (!isRecord(value)) return {};

  const options: StatusLineSegmentOptions = {};

  if ("model" in value) {
    const model = normalizeModelOptions(value.model);
    if (model) options.model = model;
  }
  if ("path" in value) {
    const path = normalizePathOptions(value.path);
    if (path) options.path = path;
  }
  if ("git" in value) {
    const git = normalizeGitOptions(value.git);
    if (git) options.git = git;
  }
  if ("time" in value) {
    const time = normalizeTimeOptions(value.time);
    if (time) options.time = time;
  }
  if ("tokens" in value) {
    const tokens = normalizeTokensOptions(value.tokens);
    if (tokens) options.tokens = tokens;
  }
  if ("cost" in value) {
    const cost = normalizeCostOptions(value.cost);
    if (cost) options.cost = cost;
  }

  return options;
}

/**
 * Shallow-merge user options on top of preset defaults.
 *
 * Each segment key is replaced wholesale if the user provided a value for it,
 * preserving intra-segment field defaults from the preset.
 */
export function mergeSegmentOptions(
  presetOptions: StatusLineSegmentOptions | undefined,
  userOptions: StatusLineSegmentOptions | undefined,
): StatusLineSegmentOptions {
  if (!presetOptions && !userOptions) return {};
  if (!presetOptions) return userOptions!;
  if (!userOptions) return presetOptions;

  return {
    model: userOptions.model ?? presetOptions.model,
    path: userOptions.path ?? presetOptions.path,
    git: userOptions.git ? { ...presetOptions.git, ...userOptions.git } : presetOptions.git,
    time: userOptions.time ?? presetOptions.time,
    tokens: userOptions.tokens ?? presetOptions.tokens,
    cost: userOptions.cost ?? presetOptions.cost,
  };
}
