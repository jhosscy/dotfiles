import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// Theme color - either a pi theme color name or a custom hex color
export type ColorValue = ThemeColor | `#${string}`;
export type ThemeLike = Pick<Theme, "fg">;

// Semantic color names for segments
export type SemanticColor =
  | "model"
  | "path"
  | "gitDirty"
  | "gitClean"
  | "thinking"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "context"
  | "contextWarn"
  | "contextError"
  | "cost"
  | "tokens"
  | "separator"
  | "border";

// Color scheme mapping semantic names to actual colors
export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

// Built-in segment identifiers
export type BuiltinStatusLineSegmentId =
  | "model"
  | "path"
  | "git"
  | "subagents"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cost"
  | "context_pct"
  | "context_total"
  | "time_spent"
  | "time"
  | "session"
  | "hostname"
  | "cache_read"
  | "cache_write"
  | "cache_hit_rate"
  | "thinking"
  | "subscription"
  | "extension_statuses";

// Segment identifiers (built-in + dynamically registered custom items)
export type StatusLineSegmentId = BuiltinStatusLineSegmentId | `custom:${string}`;

// Separator styles
export type StatusLineSeparatorStyle =
  | "powerline"
  | "powerline-thin"
  | "slash"
  | "pipe"
  | "block"
  | "none"
  | "ascii"
  | "dot"
  | "chevron"
  | "star"
  | "soft";

// Preset names
export type StatusLinePreset =
  | "default"
  | "minimal"
  | "compact"
  | "full"
  | "nerd"
  | "ascii"
  | "custom"
  | "lucy"
  | "lucy-cost"
  | "lucy-mini";

// Per-segment options
export interface StatusLineSegmentOptions {
  model?: { showThinkingLevel?: boolean };
  path?: { 
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean; showAheadBehind?: boolean };
  time?: { format?: "12h" | "24h"; showSeconds?: boolean };
  tokens?: { format?: "exact" | "compact"; showUnitPrices?: boolean };
  cost?: { mode?: "branch" | "global" };
}

export type CustomItemPosition = "left" | "right" | "secondary";

export interface CustomStatusItem {
  id: string;
  statusKey: string;
  position: CustomItemPosition;
  color?: ColorValue;
  prefix?: string;
  hideWhenMissing: boolean;
  excludeFromExtensionStatuses: boolean;
}

// Preset definition
export interface PresetDef {
  leftSegments: BuiltinStatusLineSegmentId[];
  rightSegments: BuiltinStatusLineSegmentId[];
  /** Secondary row segments (shown in footer, above sub bar) */
  secondarySegments?: BuiltinStatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  /** Color scheme for this preset */
  colors?: ColorScheme;
}

// Separator definition
export interface SeparatorDef {
  left: string;
  right: string;
  endCaps?: {
    left: string;
    right: string;
    useBgAsFg: boolean;
  };
}

// Git status data
export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

// Usage statistics
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SubscriptionRateWindow {
  label: string;
  usedPercent: number;
  resetDescription?: string;
  resetAt?: string;
}

export interface SubscriptionUsage {
  windows: SubscriptionRateWindow[];
  error?: { message: string };
}

// Context passed to segment render functions
export interface SegmentContext {
  // From pi-mono
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  sessionId: string | undefined;
  
  // Computed
  usageStats: UsageStats;
  /** Cost across ALL session entries (all branches). Used when options.cost.mode === "global". */
  globalCost?: number;
  /**
   * Prompt cache hit rate of the latest assistant message across all session entries
   * (not just the active branch), matching pi's native footer behaviour. Expressed as
   * a percentage in [0, 100]. Undefined when the latest message has no cache activity.
   */
  latestCacheHitRate?: number;
  modelCost: ModelCost;
  contextPercent: number;
  contextTokens: number;
  contextWindow: number;
  responseModel?: string;
  autoCompactEnabled: boolean;
  customCompactionEnabled: boolean;
  usingSubscription: boolean;
  subscriptionUsage?: SubscriptionUsage;
  sessionStartTime: number;
  
  // Git
  git: GitStatus;
  
  // Extension statuses
  extensionStatuses: ReadonlyMap<string, string>;
  hiddenExtensionStatusKeys: ReadonlySet<string>;
  customItemsById: ReadonlyMap<string, CustomStatusItem>;
  
  // Options
  options: StatusLineSegmentOptions;
  
  // Theming
  theme: ThemeLike;
  colors: ColorScheme;
}

// Rendered segment output
export interface RenderedSegment {
  content: string;
  visible: boolean;
}

// Segment definition
export interface StatusLineSegment {
  id: BuiltinStatusLineSegmentId;
  render(ctx: SegmentContext): RenderedSegment;
}
