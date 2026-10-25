import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// Theme color - either a pi theme color name or a custom hex color
export type ColorValue = ThemeColor | `#${string}`;
export type ThemeLike = Pick<Theme, "fg" | "style">;

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
  | "lucy-mini"
  | "native-parity";

// Per-segment options
export interface StatusLineSegmentOptions {
  model?: { showThinkingLevel?: boolean };
  path?: {
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: {
    showBranch?: boolean;
    showStaged?: boolean;
    showUnstaged?: boolean;
    showUntracked?: boolean;
    showAheadBehind?: boolean;
    polling?: "full" | "branch" | "off";
  };
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

// Git status data. `branch` comes from pi's footer data provider, the rest from
// this extension's async working-tree probe.
export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

// Usage statistics, in the shape pi's own footer aggregates them.
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// Per-million rates of the selected model. Informational only: billed cost is
// always pi's `usage.cost.total`, never a recomputation from these numbers.
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
  // Native model/session data
  model: Model<any> | undefined;
  thinkingLevel: ThinkingLevel;
  sessionId: string;
  sessionName?: string;
  cwd: string;
  sessionStartTime: number;
  // Native usage accounting
  /** Whole-session totals, the same numbers pi's footer shows. */
  usageStats: UsageStats;
  /** Active-branch totals, for `cost.mode: "branch"`. */
  branchUsageStats: UsageStats;
  /**
   * Prompt cache hit rate of the latest assistant message across all session
   * entries. Undefined when that message has no cache activity, matching pi.
   */
  latestCacheHitRate?: number;
  modelCost: ModelCost;
  // Native context accounting. `tokens`/`percent` stay null after a compaction
  // until the next LLM response, exactly as pi reports them.
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number;
  responseModel?: string;
  autoCompactEnabled: boolean;
  // Subscription
  usingSubscription: boolean;
  subscriptionUsage?: SubscriptionUsage;
  // Git
  git: GitStatus;
  // Extension statuses
  providerCount: number;
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
