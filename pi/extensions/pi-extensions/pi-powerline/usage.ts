/**
 * Usage accounting, mirroring pi's own `core/usage-totals.ts` + the totals loop
 * in `FooterComponent.getSessionStats()`.
 *
 * Every persisted `Usage` counts: assistant messages (including ones that ended
 * with `error`/`aborted`), tool results, standalone `usage` entries, compaction
 * summaries and branch summaries. Cost is always `usage.cost.total` as pi-ai
 * billed it - never a recomputation from model rates or pricing tiers.
 */
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { UsageStats } from "./types.js";

export function createUsageStats(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function addUsage(totals: UsageStats, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

export function totalTokensOf(totals: UsageStats): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

/**
 * The `Usage` a session entry contributes to the totals, if any. Same set of
 * entry shapes pi aggregates.
 */
export function getEntryUsage(entry: SessionEntry): Usage | undefined {
  switch (entry.type) {
    case "usage":
      return entry.usage;
    case "message": {
      const message = entry.message;
      if (message.role === "assistant") {
        return message.usage;
      }
      if (message.role === "toolResult") {
        return message.usage;
      }
      return undefined;
    }
    case "compaction":
    case "branch_summary":
      return entry.usage;
    default:
      return undefined;
  }
}

/** Last assistant message in the given entries, if any. */
function getLastAssistant(entry: SessionEntry): AssistantMessage | undefined {
  if (entry.type !== "message" || entry.message.role !== "assistant") {
    return undefined;
  }
  return entry.message;
}

export interface UsageAggregate {
  totals: UsageStats;
  /** Model that produced the newest assistant message, for routed/virtual models. */
  responseModel?: string;
  /** Newest assistant usage, used for the cache hit rate. */
  lastAssistantUsage?: Usage;
}

export function createUsageAggregate(): UsageAggregate {
  return { totals: createUsageStats() };
}

/** Fold one entry into an existing aggregate. */
export function foldEntry(aggregate: UsageAggregate, entry: SessionEntry): UsageAggregate {
  const usage = getEntryUsage(entry);
  if (usage) {
    addUsage(aggregate.totals, usage);
  }
  const assistant = getLastAssistant(entry);
  if (assistant) {
    aggregate.lastAssistantUsage = assistant.usage;
    aggregate.responseModel = assistant.responseModel ?? assistant.model;
  }
  return aggregate;
}

/** Aggregate a full entry list (used for the active branch). */
export function aggregateEntries(entries: readonly SessionEntry[]): UsageAggregate {
  const aggregate = createUsageAggregate();
  for (const entry of entries) {
    foldEntry(aggregate, entry);
  }
  return aggregate;
}

/**
 * Cache hit rate of the newest assistant message. pi hides it entirely when
 * that message had no cache activity, so this returns undefined in that case.
 */
export function cacheHitRateOf(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

/**
 * Incremental whole-session aggregate.
 *
 * The session log is append-only, so a cached aggregate can be extended with the
 * entries appended since the last build instead of rescanning the whole session
 * on every message. A different session id or a shrunk entry list (session
 * replaced) starts over.
 */
export interface IncrementalUsageAggregate {
  get(entries: readonly SessionEntry[], sessionId: string): UsageAggregate;
}

export function createIncrementalUsageAggregate(): IncrementalUsageAggregate {
  let sessionId: string | null = null;
  let consumed = 0;
  let aggregate: UsageAggregate = createUsageAggregate();
  return {
    get(entries, nextSessionId) {
      if (sessionId !== nextSessionId || entries.length < consumed) {
        sessionId = nextSessionId;
        consumed = 0;
        aggregate = createUsageAggregate();
      }
      for (let i = consumed; i < entries.length; i++) {
        foldEntry(aggregate, entries[i]!);
      }
      consumed = entries.length;
      return aggregate;
    },
  };
}
