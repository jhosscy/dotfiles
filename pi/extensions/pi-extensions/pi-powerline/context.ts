/**
 * Faithful normalization of pi's own context usage estimate.
 *
 * `tokens` and `percent` are legitimately `null` right after a compaction (or a
 * context edit) until the next LLM response. They are preserved as `null` here
 * so the footer can render `?/window` like pi does, instead of falling back to
 * a stale pre-compaction number.
 */
import type { ContextUsage, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ContextUsageView {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeContextUsage(
  usage: ContextUsage | undefined,
  fallbackWindow: number,
): ContextUsageView {
  const contextWindow = isFiniteNumber(usage?.contextWindow) && usage.contextWindow > 0
    ? usage.contextWindow
    : isFiniteNumber(fallbackWindow) && fallbackWindow > 0
      ? fallbackWindow
      : 0;
  const tokens = isFiniteNumber(usage?.tokens) ? usage.tokens : null;
  const reportedPercent = isFiniteNumber(usage?.percent) ? usage.percent : null;
  const percent = reportedPercent ?? (tokens !== null && contextWindow > 0 ? (tokens / contextWindow) * 100 : null);
  return { tokens, contextWindow, percent };
}

export function readContextUsage(ctx: ExtensionContext): ContextUsageView {
  let usage: ContextUsage | undefined;
  try {
    usage = ctx.getContextUsage();
  } catch {
    usage = undefined;
  }
  return normalizeContextUsage(usage, ctx.model?.contextWindow ?? 0);
}
