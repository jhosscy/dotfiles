/**
 * Native snapshot: everything the footer shows that pi already knows, read
 * through pi's own APIs and cached.
 *
 * Rebuilding is triggered by lifecycle events (message_end, turn_end,
 * tool_result, compaction, tree, model/thinking change). Between events a render
 * only compares `sessionId + leafId + model id + invalidation counter`, so it is
 * O(1) instead of rescanning the session.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { readContextUsage, type ContextUsageView } from "./context.js";
import { getPreset } from "./presets.js";
import {
  collectHiddenExtensionStatusKeys,
  mergeSegmentOptions,
  type PowerlineConfig,
} from "./powerline-config.js";
import { isSubscriptionModel, type SubCoreBridge } from "./subscription.js";
import { getDefaultColors } from "./theme.js";
import type {
  ColorScheme,
  CustomStatusItem,
  GitStatus,
  ModelCost,
  SegmentContext,
  StatusLineSegmentOptions,
  StatusLinePreset,
  ThemeLike,
  UsageStats,
} from "./types.js";
import {
  aggregateEntries,
  cacheHitRateOf,
  createIncrementalUsageAggregate,
  type UsageAggregate,
} from "./usage.js";

export interface NativeSnapshot {
  sessionId: string;
  leafId: string | null;
  cwd: string;
  sessionName?: string;
  model: Model<any> | undefined;
  thinkingLevel: ThinkingLevel;
  context: ContextUsageView;
  /** Whole-session totals, the numbers pi's footer shows. */
  totals: UsageStats;
  /** Active-branch totals. */
  branchTotals: UsageStats;
  latestCacheHitRate?: number;
  responseModel?: string;
  usingSubscription: boolean;
}

export interface SnapshotCache {
  get(ctx: ExtensionContext, invalidation: number): NativeSnapshot;
  reset(): void;
}

export function createSnapshotCache(): SnapshotCache {
  const incremental = createIncrementalUsageAggregate();
  let cached: { key: string; snapshot: NativeSnapshot } | null = null;

  function build(ctx: ExtensionContext): NativeSnapshot {
    const sessionManager = ctx.sessionManager;
    const sessionId = sessionManager.getSessionId();
    const entries = sessionManager.getEntries();
    const totalsAggregate: UsageAggregate = incremental.get(entries, sessionId);
    const branchAggregate = aggregateEntries(sessionManager.getBranch());
    const model = ctx.model;
    return {
      sessionId,
      leafId: sessionManager.getLeafId(),
      cwd: sessionManager.getCwd(),
      sessionName: sessionManager.getSessionName(),
      model,
      thinkingLevel: ctx.thinkingLevel ?? "off",
      context: readContextUsage(ctx),
      // Copy: the incremental aggregate is mutated in place as entries arrive.
      totals: { ...totalsAggregate.totals },
      branchTotals: { ...branchAggregate.totals },
      latestCacheHitRate: cacheHitRateOf(totalsAggregate.lastAssistantUsage),
      responseModel: totalsAggregate.responseModel,
      usingSubscription: isSubscriptionModel(ctx, model),
    };
  }

  return {
    get(ctx, invalidation) {
      const sessionManager = ctx.sessionManager;
      const key = [
        sessionManager.getSessionId(),
        sessionManager.getLeafId() ?? "-",
        ctx.model?.id ?? "-",
        ctx.thinkingLevel ?? "-",
        String(invalidation),
      ].join("|");
      if (cached?.key === key) return cached.snapshot;
      const snapshot = build(ctx);
      cached = { key, snapshot };
      return snapshot;
    },
    reset() {
      cached = null;
    },
  };
}

export interface SegmentContextInput {
  snapshot: NativeSnapshot;
  config: PowerlineConfig;
  preset: StatusLinePreset;
  theme: ThemeLike;
  footerData: ReadonlyFooterDataProvider;
  git: GitStatus;
  subscriptionUsage?: SegmentContext["subscriptionUsage"];
  autoCompactEnabled: boolean;
  sessionStartTime: number;
}

function modelCostOf(model: Model<any> | undefined): ModelCost {
  const cost = model?.cost;
  return {
    input: typeof cost?.input === "number" ? cost.input : 0,
    output: typeof cost?.output === "number" ? cost.output : 0,
    cacheRead: typeof cost?.cacheRead === "number" ? cost.cacheRead : 0,
    cacheWrite: typeof cost?.cacheWrite === "number" ? cost.cacheWrite : 0,
  };
}

function customItemsByIdOf(items: readonly CustomStatusItem[]): ReadonlyMap<string, CustomStatusItem> {
  return new Map(items.map((item) => [item.id, item]));
}

export function buildSegmentContext(input: SegmentContextInput): SegmentContext {
  const { snapshot, config, preset, theme, footerData, git } = input;
  const presetDef = getPreset(preset);
  const colors: ColorScheme = presetDef.colors ?? getDefaultColors();
  const options: StatusLineSegmentOptions = mergeSegmentOptions(
    presetDef.segmentOptions,
    config.segmentOptions,
  );
  return {
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    sessionId: snapshot.sessionId,
    sessionName: snapshot.sessionName,
    cwd: snapshot.cwd,
    sessionStartTime: input.sessionStartTime,
    usageStats: snapshot.totals,
    branchUsageStats: snapshot.branchTotals,
    latestCacheHitRate: snapshot.latestCacheHitRate,
    modelCost: modelCostOf(snapshot.model),
    contextTokens: snapshot.context.tokens,
    contextPercent: snapshot.context.percent,
    contextWindow: snapshot.context.contextWindow,
    responseModel: snapshot.responseModel,
    autoCompactEnabled: input.autoCompactEnabled,
    usingSubscription: snapshot.usingSubscription,
    subscriptionUsage: input.subscriptionUsage,
    git,
    providerCount: footerData.getAvailableProviderCount(),
    extensionStatuses: footerData.getExtensionStatuses(),
    hiddenExtensionStatusKeys: collectHiddenExtensionStatusKeys(config.customItems),
    customItemsById: customItemsByIdOf(config.customItems),
    options,
    theme,
    colors,
  };
}

/** Optional bridge: quota data from the standalone `pi-sub-core` extension. */
export type { SubCoreBridge };
