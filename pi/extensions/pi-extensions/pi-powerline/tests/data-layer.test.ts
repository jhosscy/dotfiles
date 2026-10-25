/**
 * Smoke test for the data layer and layout. Not shipped in the package.
 * Run with: bun run tests/data-layer.test.ts
 */
import assert from "node:assert/strict";
import { aggregateEntries, cacheHitRateOf, createIncrementalUsageAggregate } from "../usage.js";
import { normalizeContextUsage } from "../context.js";
import { parseGitStatusPorcelainV2 } from "../git.js";
import { parsePowerlineConfig, mergeSegmentOptions, normalizeExtensionStatusValue } from "../powerline-config.js";
import { getPreset } from "../presets.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { computeLayout } from "../status-layout.js";
import { setThemeOverrides } from "../theme.js";
import type { SegmentContext } from "../types.js";

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

const entry = (id: string, type: string, payload: Record<string, unknown>) =>
  ({ id, parentId: null, timestamp: new Date().toISOString(), type, ...payload }) as never;

// ── usage: every persisted Usage counts, error/aborted included ────────────
const entries = [
  entry("1", "message", {
    message: { role: "assistant", model: "m", usage: usage(100, 10, 900, 0, 0.5), stopReason: "stop" },
  }),
  entry("2", "message", {
    message: { role: "assistant", model: "m", usage: usage(50, 5, 0, 0, 0.25), stopReason: "error" },
  }),
  entry("3", "message", {
    message: { role: "toolResult", toolName: "bash", usage: usage(7, 0, 0, 0, 0.01) },
  }),
  entry("4", "usage", { kind: "cache_warm", provider: "p", model: "m", usage: usage(3, 0, 0, 0, 0.02) }),
  entry("5", "compaction", { usage: usage(11, 1, 0, 0, 0.03) }),
  entry("6", "branch_summary", { usage: usage(13, 2, 0, 0, 0.04) }),
  entry("7", "message", { message: { role: "user", content: "hi" } }),
];

const agg = aggregateEntries(entries);
assert.equal(agg.totals.input, 100 + 50 + 7 + 3 + 11 + 13);
assert.equal(agg.totals.output, 10 + 5 + 1 + 2);
assert.equal(agg.totals.cacheRead, 900);
assert.ok(Math.abs(agg.totals.cost - (0.5 + 0.25 + 0.01 + 0.02 + 0.03 + 0.04)) < 1e-9);
// CH comes from the newest assistant message only (the aborted one, no cache
// read, so pi's own formula yields 0 rather than "unknown").
assert.equal(cacheHitRateOf(agg.lastAssistantUsage), 0);
assert.equal(agg.responseModel, "m");

// ── incremental aggregate matches a full scan ──────────────────────────────
const incremental = createIncrementalUsageAggregate();
incremental.get(entries.slice(0, 3), "s1");
const grown = incremental.get(entries, "s1");
assert.deepEqual(grown.totals, aggregateEntries(entries).totals);
const otherSession = incremental.get(entries, "s2");
assert.deepEqual(otherSession.totals, aggregateEntries(entries).totals);

// ── context keeps null after compaction ────────────────────────────────────
assert.deepEqual(normalizeContextUsage({ tokens: null, contextWindow: 1000, percent: null }, 1000), {
  tokens: null,
  contextWindow: 1000,
  percent: null,
});
assert.deepEqual(normalizeContextUsage({ tokens: 288, contextWindow: 1000, percent: 28.8 }, 0), {
  tokens: 288,
  contextWindow: 1000,
  percent: 28.8,
});
assert.equal(normalizeContextUsage(undefined, 2000).contextWindow, 2000);

// ── git porcelain v2 ───────────────────────────────────────────────────────
const dirty = parseGitStatusPorcelainV2(
  ["# branch.oid abc", "# branch.head main", "# branch.ab +2 -1", "1 M. N... 100644 100644 100644 a b file.ts", "2 R. N... 100644 100644 100644 a b R100 new.ts", "? untracked.ts", "! ignored.ts"].join("\n"),
);
assert.deepEqual(dirty, { staged: 2, unstaged: 0, untracked: 1, ahead: 2, behind: 1 });

// ── config parsing + status sanitization ───────────────────────────────────
const parsed = parsePowerlineConfig(
  { preset: "native-parity", segmentOptions: { cost: { mode: "global" }, git: { polling: "branch" } } },
  ["default", "native-parity"],
);
assert.equal(parsed.preset, "native-parity");
assert.deepEqual(mergeSegmentOptions(getPreset("native-parity").segmentOptions, parsed.segmentOptions).git, {
  showBranch: true,
  showStaged: true,
  showUnstaged: true,
  showUntracked: true,
  polling: "branch",
});
assert.equal(normalizeExtensionStatusValue("[ci] ok\nsecond line"), "[ci] ok second line");
assert.equal(normalizeExtensionStatusValue("\u0007\u0007"), null);

// ── layout ─────────────────────────────────────────────────────────────────
setThemeOverrides(undefined);
const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
} as never;

function ctxFor(overrides: Partial<SegmentContext> = {}): SegmentContext {
  return {
    model: { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic", reasoning: true, contextWindow: 1_000_000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    thinkingLevel: "medium",
    sessionId: "sess-1234",
    sessionName: "refactor",
    cwd: "/home/user/project",
    sessionStartTime: Date.now() - 65_000,
    usageStats: agg.totals,
    branchUsageStats: agg.totals,
    latestCacheHitRate: 99.9,
    modelCost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextTokens: null,
    contextPercent: null,
    contextWindow: 1_000_000,
    responseModel: "m",
    autoCompactEnabled: false,
    usingSubscription: true,
    git: { branch: "main", staged: 1, unstaged: 2, untracked: 0, ahead: 2, behind: 1 },
    providerCount: 2,
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options: mergeSegmentOptions(getPreset("native-parity").segmentOptions, {}),
    theme: theme as never,
    colors: getPreset("native-parity").colors ?? {},
    ...overrides,
  } as SegmentContext;
}

const wide = computeLayout(ctxFor(), getPreset("native-parity"), [], 200);
assert.match(wide.top, /\?\/1M/, "unknown context renders as ?/window");
assert.match(wide.top, /\$0\.85 \(sub\)/, "subscription keeps the amount");
assert.ok(!wide.secondary, "nothing overflows on a wide terminal");

// Left-aligned mode (editor border): one flowing row, no right padding, so the
// caller can fill the rest of the line with `─`.
const leftAligned = computeLayout(ctxFor(), getPreset("native-parity"), [], 200, { align: "left" });
assert.ok(leftAligned.top.startsWith(" ") && leftAligned.top.endsWith(" "));
assert.ok(
  visibleWidth(leftAligned.top) < 200,
  "left-aligned rows are not padded to the full width",
);

const narrow = computeLayout(ctxFor(), getPreset("native-parity"), [], 40);
assert.ok(narrow.top.length > 0);
assert.ok(narrow.secondary.length > 0, "narrow terminal overflows to the secondary row");
for (const line of [narrow.top, narrow.secondary, wide.top]) {
  assert.ok(line.length > 0);
}

const thinkingHidden = computeLayout(
  ctxFor({ model: { id: "x", name: "x", provider: "p", reasoning: false, contextWindow: 1000, cost: {} } as never }),
  getPreset("default"),
  [],
  200,
);
assert.ok(!thinkingHidden.top.includes("think:"), "no thinking segment on non-reasoning models");

const cacheIdle = computeLayout(
  ctxFor({ usageStats: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0 }, latestCacheHitRate: undefined }),
  getPreset("native-parity"),
  [],
  200,
);
assert.ok(!cacheIdle.top.includes("CH"), "no 0.0% cache hit without cache activity");

console.log("smoke: ok");
