/**
 * Read Pi's core context usage estimate.
 *
 * Pi exposes `ctx.getContextUsage()` which returns Pi's own estimate of the
 * context window. This is what powers the native footer and is also the most
 * accurate value for branch summaries (e.g. when navigating the session tree
 * with `/tree`). Falling back to the last persisted assistant usage would
 * leave the segment stuck on the previous branch's value.
 */

export interface CoreContextUsage {
  contextTokens: number;
  contextWindow: number;
  contextPercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readCoreContextUsage(ctx: unknown): CoreContextUsage | null {
  if (!isRecord(ctx) || typeof ctx.getContextUsage !== "function") {
    return null;
  }

  const usage = ctx.getContextUsage();
  if (!isRecord(usage)) {
    return null;
  }

  const tokens = usage.tokens;
  const contextWindow = usage.contextWindow;
  if (
    typeof tokens !== "number"
    || !Number.isFinite(tokens)
    || typeof contextWindow !== "number"
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
  }

  const percent = usage.percent;
  return {
    contextTokens: tokens,
    contextWindow,
    contextPercent: typeof percent === "number" && Number.isFinite(percent)
      ? percent
      : (tokens / contextWindow) * 100,
  };
}
