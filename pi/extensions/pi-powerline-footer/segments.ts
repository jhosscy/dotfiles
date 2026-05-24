import { hostname as osHostname } from "node:os";
import { basename } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BuiltinStatusLineSegmentId, RenderedSegment, SegmentContext, SemanticColor, StatusLineSegment, StatusLineSegmentId } from "./types.ts";
import { normalizeCompactExtensionStatus, normalizeExtensionStatusValue } from "./powerline-config.ts";
import { fg, rainbow, applyColor } from "./theme.ts";
import { getIcons, SEP_DOT, getThinkingText } from "./icons.ts";

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number, mode: "exact" | "compact" = "exact"): string {
  if (mode === "exact") return n.toLocaleString("en-US");
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return n.toLocaleString("en-US");
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

function subscriptionColor(ctx: SegmentContext, pct: number, text: string): string {
  if (pct > 80) return color(ctx, "contextError", text);
  if (pct > 60) return color(ctx, "contextWarn", text);
  return color(ctx, "cost", text);
}

function renderSubscriptionBlocks(ctx: SegmentContext, pct: number, width: number): string {
  const levels = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  const clamped = Math.max(0, Math.min(100, pct));
  const filledFloat = (clamped / 100) * width;
  const filledFull = Math.floor(filledFloat);
  const remainder = filledFloat - filledFull;
  const filled = subscriptionColor(ctx, pct, "█".repeat(filledFull));

  let partial = "";
  let emptyCount = width - filledFull;
  if (remainder >= 0.0625 && filledFull < width) {
    const levelIndex = Math.max(0, Math.min(levels.length - 1, Math.round(remainder * 8) - 1));
    partial = subscriptionColor(ctx, pct, levels[levelIndex]);
    emptyCount = Math.max(0, emptyCount - 1);
  }

  return `${filled}${partial}${color(ctx, "separator", "░".repeat(emptyCount))}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};

    let modelName = ctx.model?.name || ctx.model?.id || "no-model";
    // Strip "Claude " prefix for brevity
    if (modelName.startsWith("Claude ")) {
      modelName = modelName.slice(7);
    }

    let content = withIcon(icons.model, modelName);

    // Show actual routed model when it differs (e.g. OpenRouter auto → concrete model)
    if (ctx.responseModel) {
      const modelId = ctx.model?.id ?? "";
      const modelName = ctx.model?.name ?? "";
      const rm = ctx.responseModel;
      if (rm !== modelId && rm !== modelName && !modelId.includes(rm) && !rm.includes(modelId)) {
        content += ` → ${rm}`;
      }
    }

    if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      if (level !== "off") {
        const thinkingText = getThinkingText(level);
        if (thinkingText) {
          content += `${SEP_DOT}${thinkingText}`;
        }
      }
    }

    return { content: color(ctx, "model", content), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.path ?? {};
    const mode = opts.mode ?? "basename";

    let pwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE;

    if (mode === "basename") {
      // Just the last directory component (cross-platform)
      pwd = basename(pwd) || pwd;
    } else {
      // Abbreviate home directory for abbreviated/full modes
      if (home && pwd.startsWith(home)) {
        pwd = `~${pwd.slice(home.length)}`;
      }

      // Strip /work/ prefix (common in containers)
      if (pwd.startsWith("/work/")) {
        pwd = pwd.slice(6);
      }

      // Truncate if too long (only for abbreviated mode)
      if (mode === "abbreviated") {
        const maxLen = opts.maxLength ?? 40;
        if (pwd.length > maxLen) {
          pwd = `…${pwd.slice(-(maxLen - 1))}`;
        }
      }
    }

    const content = withIcon(icons.folder, pwd);
    return { content: color(ctx, "path", content), visible: true };
  },
};

const gitSegment: StatusLineSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked, ahead, behind } = ctx.git;
    const hasFileChanges = staged > 0 || unstaged > 0 || untracked > 0;
    const hasAheadBehind = ahead > 0 || behind > 0;
    const gitStatus = hasFileChanges ? { staged, unstaged, untracked } : null;

    if (!branch && !gitStatus && !hasAheadBehind) return { content: "", visible: false };

    const isDirty = hasFileChanges;
    const showBranch = opts.showBranch !== false;
    const showAheadBehind = opts.showAheadBehind !== false;
    const branchColor: SemanticColor = isDirty ? "gitDirty" : "gitClean";

    // Build content - color branch separately from indicators
    let content = "";
    if (showBranch && branch) {
      // Color just the branch name (icon + branch text)
      content = color(ctx, branchColor, withIcon(icons.branch, branch));
    }

    // Indicators: ahead/behind first, then file changes
    const indicators: string[] = [];
    if (showAheadBehind) {
      if (ahead > 0) {
        indicators.push(applyColor(ctx.theme, "success", `↑${ahead}`));
      }
      if (behind > 0) {
        indicators.push(applyColor(ctx.theme, "warning", `↓${behind}`));
      }
    }
    if (gitStatus) {
      if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
        indicators.push(applyColor(ctx.theme, "warning", `*${gitStatus.unstaged}`));
      }
      if (opts.showStaged !== false && gitStatus.staged > 0) {
        indicators.push(applyColor(ctx.theme, "success", `+${gitStatus.staged}`));
      }
      if (opts.showUntracked !== false && gitStatus.untracked > 0) {
        indicators.push(applyColor(ctx.theme, "muted", `?${gitStatus.untracked}`));
      }
    }
    if (indicators.length > 0) {
      const indicatorText = indicators.join(" ");
      if (!content && showBranch === false) {
        // No branch shown, color the git icon with branch color
        content = color(ctx, branchColor, icons.git ? `${icons.git} ` : "") + indicatorText;
      } else {
        content += content ? ` ${indicatorText}` : indicatorText;
      }
    }

    if (!content) return { content: "", visible: false };

    return { content, visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";

    const levelText: Record<string, string> = {
      off: "off",
      minimal: "min",
      low: "low",
      medium: "med",
      high: "high",
      xhigh: "xhigh",
    };
    const label = levelText[level] || level;
    const content = `think:${label}`;

    if (level === "high" || level === "xhigh") {
      return { content: rainbow(content), visible: true };
    }

    if (level === "minimal") {
      return { content: color(ctx, "thinkingMinimal", content), visible: true };
    }
    if (level === "low") {
      return { content: color(ctx, "thinkingLow", content), visible: true };
    }
    if (level === "medium") {
      return { content: color(ctx, "thinkingMedium", content), visible: true };
    }

    return { content: color(ctx, "thinking", content), visible: true };
  },
};

const subagentsSegment: StatusLineSegment = {
  id: "subagents",
  render() {
    // Note: pi-mono doesn't have subagent tracking built-in
    // This would require extension state management
    // For now, return not visible
    return { content: "", visible: false };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };

    const opts = ctx.options.tokens ?? {};
    const tokenFormat = opts.format ?? "exact";
    const showUnitPrices = opts.showUnitPrices !== false;
    const tokenText = color(ctx, "tokens", withIcon(icons.input, formatTokens(input, tokenFormat)));
    const price = showUnitPrices && ctx.modelCost.input > 0 ? `${SEP_DOT}${color(ctx, "cost", `${formatCost(ctx.modelCost.input)}/M`)}` : "";
    return { content: `${tokenText}${price}`, visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };

    const opts = ctx.options.tokens ?? {};
    const tokenFormat = opts.format ?? "exact";
    const showUnitPrices = opts.showUnitPrices !== false;
    const tokenText = color(ctx, "tokens", withIcon(icons.output, formatTokens(output, tokenFormat)));
    const price = showUnitPrices && ctx.modelCost.output > 0 ? `${SEP_DOT}${color(ctx, "cost", `${formatCost(ctx.modelCost.output)}/M`)}` : "";
    return { content: `${tokenText}${price}`, visible: true };
  },
};

const tokenTotalSegment: StatusLineSegment = {
  id: "token_total",
  render(ctx) {
    const icons = getIcons();
    const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
    const total = input + output + cacheRead + cacheWrite;
    if (!total) return { content: "", visible: false };

    const tokenFormat = ctx.options.tokens?.format ?? "exact";
    const content = withIcon(icons.tokens, formatTokens(total, tokenFormat));
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  // Sub-dollar: strip trailing zeros, up to 6 decimals
  return `$${parseFloat(n.toFixed(6))}`;
}

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const isGlobal = ctx.options.cost?.mode === "global";
    const cost = isGlobal ? (ctx.globalCost ?? ctx.usageStats.cost) : ctx.usageStats.cost;
    const usingSubscription = ctx.usingSubscription;

    if (!cost && !usingSubscription) {
      return { content: "", visible: false };
    }

    const costDisplay = usingSubscription ? "(sub)" : formatCost(cost);
    return { content: color(ctx, "cost", costDisplay), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const tokens = ctx.contextTokens;
    const window = ctx.contextWindow;
    const pct = ctx.contextPercent;

    const tokenFormat = ctx.options.tokens?.format ?? "exact";
    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";
    const text = `${formatTokens(tokens, tokenFormat)}/${formatTokens(window, tokenFormat)}${autoIcon}`;

    // Icon outside color, text inside - use semantic colors for thresholds
    let content: string;
    if (pct > 90) {
      content = withIcon(icons.context, color(ctx, "contextError", text));
    } else if (pct > 70) {
      content = withIcon(icons.context, color(ctx, "contextWarn", text));
    } else {
      content = withIcon(icons.context, color(ctx, "context", text));
    }

    return { content, visible: true };
  },
};

const contextTotalSegment: StatusLineSegment = {
  id: "context_total",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const window = ctx.contextWindow;
    if (!window) return { content: "", visible: false };

    return {
      content: color(ctx, "context", withIcon(icons.context, formatTokens(window))),
      visible: true,
    };
  },
};

const timeSpentSegment: StatusLineSegment = {
  id: "time_spent",
  render(ctx) {
    const icons = getIcons();
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) return { content: "", visible: false };

    return { content: withIcon(icons.time, formatDuration(elapsed)), visible: true };
  },
};

const timeSegment: StatusLineSegment = {
  id: "time",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.time ?? {};
    const now = new Date();

    let hours = now.getHours();
    let suffix = "";
    if (opts.format === "12h") {
      suffix = hours >= 12 ? "pm" : "am";
      hours = hours % 12 || 12;
    }

    const mins = now.getMinutes().toString().padStart(2, "0");
    let timeStr = `${hours}:${mins}`;
    if (opts.showSeconds) {
      timeStr += `:${now.getSeconds().toString().padStart(2, "0")}`;
    }
    timeStr += suffix;

    return { content: withIcon(icons.time, timeStr), visible: true };
  },
};

const sessionSegment: StatusLineSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    const sessionId = ctx.sessionId;
    const display = sessionId?.slice(0, 8) || "new";

    return { content: withIcon(icons.session, display), visible: true };
  },
};

const hostnameSegment: StatusLineSegment = {
  id: "hostname",
  render() {
    const icons = getIcons();
    const name = osHostname().split(".")[0];
    return { content: withIcon(icons.host, name), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    const { cacheRead } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };

    const opts = ctx.options.tokens ?? {};
    const tokenFormat = opts.format ?? "exact";
    const showUnitPrices = opts.showUnitPrices !== false;
    const parts = [icons.cache, icons.input, formatTokens(cacheRead, tokenFormat)].filter(Boolean);
    const tokenText = color(ctx, "tokens", parts.join(" "));
    const price = showUnitPrices && ctx.modelCost.cacheRead > 0 ? `${SEP_DOT}${color(ctx, "cost", `${formatCost(ctx.modelCost.cacheRead)}/M`)}` : "";
    return { content: `${tokenText}${price}`, visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };

    const tokenFormat = ctx.options.tokens?.format ?? "exact";
    const parts = [icons.cache, icons.output, formatTokens(cacheWrite, tokenFormat)].filter(Boolean);
    const content = parts.join(" ");
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const subscriptionSegment: StatusLineSegment = {
  id: "subscription",
  render(ctx) {
    const usage = ctx.subscriptionUsage;
    if (!ctx.usingSubscription || !usage || usage.windows.length === 0) return { content: "", visible: false };

    const windows = usage.windows.slice(0, 2);
    const parts = windows.map((window, index) => {
      const pct = Math.round(window.usedPercent);
      const label = window.label || "Sub";
      const reset = window.resetDescription ? ` ${window.resetDescription}` : "";
      const icon = index === 0 ? "󱐋" : "󰸗";
      const barSegments = index === 0 ? 6 : 8;
      return [
        subscriptionColor(ctx, pct, `${icon} ${label}${reset}`),
        renderSubscriptionBlocks(ctx, pct, barSegments),
        subscriptionColor(ctx, pct, `${pct}%`),
      ].join(" ");
    });

    return { content: parts.join(` ${SEP_DOT} `), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0) return { content: "", visible: false };

    // Join compact statuses with a separator
    // Skip: empty strings, notification-style ("[...") shown above editor,
    // and strings that are only ANSI codes with no visible text.
    // Also skip statuses explicitly elevated into dedicated custom segments.
    const parts: string[] = [];
    for (const [statusKey, value] of statuses.entries()) {
      if (ctx.hiddenExtensionStatusKeys.has(statusKey)) continue;
      const normalized = value ? normalizeCompactExtensionStatus(value) : null;
      if (normalized) {
        parts.push(normalized);
      }
    }

    if (parts.length === 0) return { content: "", visible: false };

    // Statuses already have their own styling applied by the extensions
    const content = parts.join(` ${SEP_DOT} `);
    return { content, visible: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<BuiltinStatusLineSegmentId, StatusLineSegment> = {
  model: modelSegment,
  path: pathSegment,
  git: gitSegment,
  thinking: thinkingSegment,
  subagents: subagentsSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cost: costSegment,
  context_pct: contextPctSegment,
  context_total: contextTotalSegment,
  time_spent: timeSpentSegment,
  time: timeSegment,
  session: sessionSegment,
  hostname: hostnameSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  subscription: subscriptionSegment,
  extension_statuses: extensionStatusesSegment,
};

function renderCustomSegment(id: `custom:${string}`, ctx: SegmentContext): RenderedSegment {
  const customItemId = id.slice("custom:".length);
  const custom = ctx.customItemsById.get(customItemId);
  if (!custom) return { content: "", visible: false };

  const rawStatus = ctx.extensionStatuses.get(custom.statusKey);
  const normalizedStatus = rawStatus ? normalizeExtensionStatusValue(rawStatus) : null;
  if (!normalizedStatus) {
    return custom.hideWhenMissing ? { content: "", visible: false } : { content: custom.prefix ?? custom.id, visible: true };
  }

  let content = normalizedStatus;
  if (custom.prefix) {
    content = `${custom.prefix}${SEP_DOT}${content}`;
  }
  if (custom.color) {
    content = applyColor(ctx.theme, custom.color, content);
  }

  return { content, visible: true };
}

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  if (id.startsWith("custom:")) {
    return renderCustomSegment(id, ctx);
  }

  const segment = SEGMENTS[id];
  if (!segment) {
    return { content: "", visible: false };
  }
  return segment.render(ctx);
}
