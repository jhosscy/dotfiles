/**
 * End-to-end wiring test with a fake pi API and a fake terminal.
 * Run with: bun run tests/wiring.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import powerline from "../index.js";

// Isolate settings: the extension reads <agent-dir>/settings.json.
const agentDir = mkdtempSync(join(tmpdir(), "pi-powerline-"));
writeFileSync(
  join(agentDir, "settings.json"),
  JSON.stringify({ powerline: { preset: "native-parity" }, compaction: { enabled: false } }),
);
process.env.PI_CODING_AGENT_DIR = agentDir;

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

const sessionEntry = (id: string, type: string, payload: Record<string, unknown>) =>
  ({ id, parentId: null, timestamp: new Date().toISOString(), type, ...payload }) as never;

const entries = [
  sessionEntry("1", "message", {
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      responseModel: "claude-sonnet-4-5",
      usage: usage(556_548, 23_998, 6_545_024, 12_000, 0.19605636),
      stopReason: "stop",
    },
  }),
  sessionEntry("2", "message", {
    message: { role: "toolResult", toolName: "bash", usage: usage(10, 0, 0, 0, 0.001) },
  }),
  sessionEntry("3", "usage", {
    kind: "cache_warm",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: usage(5, 0, 0, 0, 0.0005),
  }),
];

const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
let commandHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
let footerFactory: ((tui: unknown, theme: unknown, footerData: unknown) => unknown) | undefined;
const widgets = new Map<string, (tui: unknown, theme: unknown) => unknown>();
let renders = 0;
const notifications: string[] = [];

const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
};

let contextTokens: number | null = 288_000;
let contextPercent: number | null = 28.8;
const statuses = new Map<string, string>([["ci", "CI ok"]]);

const footerData = {
  getGitBranch: () => "main",
  getExtensionStatuses: () => statuses,
  getAvailableProviderCount: () => 2,
  onBranchChange: () => () => {},
};

// Fake editors. The default one draws pi's real shape: a full-width top border,
// content, a bottom border.
type FakeEditor = {
  embedWorkingStatus?: boolean;
  actionHandlers?: Map<string, unknown>;
  setWorkingStatusIndicator?(): void;
  getText(): string;
  setText(text: string): void;
  render(width: number): string[];
};

function createBaseEditor(): FakeEditor {
  return {
    embedWorkingStatus: true,
    actionHandlers: new Map(),
    setWorkingStatusIndicator() {},
    getText: () => "",
    setText: () => {},
    render(width: number) {
      const top = "─".repeat(width);
      const body = ` > ${" ".repeat(Math.max(0, width - 4))} `;
      return [top, body, "─".repeat(width)];
    },
  };
}

function createCornerEditor(): FakeEditor {
  const base = createBaseEditor();
  return {
    ...base,
    render(width: number) {
      const [, body, bottom] = base.render(width);
      return [`╭${"─".repeat(width - 2)}╮`, body!, bottom!];
    },
  };
}

function createScrollEditor(): FakeEditor {
  const base = createBaseEditor();
  return {
    ...base,
    render(width: number) {
      const label = " ↑ 2 more ";
      const left = "─".repeat(20);
      const rest = "─".repeat(Math.max(0, width - 20 - label.length));
      const [, body, bottom] = base.render(width);
      return [left + label + rest, body!, bottom!];
    },
  };
}

function createBorderlessEditor(): FakeEditor {
  return {
    getText: () => "",
    setText: () => {},
    render: (width: number) => [` > ${" ".repeat(Math.max(0, width - 3))}`],
  };
}

type EditorFactory = (tui: unknown, editorTheme: unknown, keybindings: unknown) => FakeEditor;
// Mirrors pi's `editorComponentFactory`: whatever the last setEditorComponent()
// stored is what getEditorComponent() returns.
let currentEditorFactory: EditorFactory | undefined = createBaseEditor;

const ctx = {
  hasUI: true,
  cwd: "/home/boxuser/project",
  mode: "tui",
  thinkingLevel: "medium",
  model: {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    reasoning: true,
    contextWindow: 1_000_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  modelRegistry: {
    isUsingOAuth: () => true,
    getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
  },
  getContextUsage: () => ({ tokens: contextTokens, contextWindow: 1_000_000, percent: contextPercent }),
  sessionManager: {
    getSessionId: () => "sess-abcdef123",
    getLeafId: () => "3",
    getEntries: () => entries,
    getBranch: () => entries,
    getCwd: () => "/home/boxuser/project",
    getSessionName: () => "refactor-footer",
  },
  ui: {
    setFooter(factory: typeof footerFactory) {
      footerFactory = factory;
    },
    setWidget(key: string, factory: (tui: unknown, theme: unknown) => unknown) {
      if (factory) widgets.set(key, factory);
      else widgets.delete(key);
    },
    notify(message: string) {
      notifications.push(message);
    },
    getEditorComponent: () => currentEditorFactory,
    setEditorComponent(factory: EditorFactory | undefined) {
      currentEditorFactory = factory;
    },
  },
};

const tui = { requestRender: () => { renders++; } };

const pi = {
  on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
    return () => {};
  },
  events: { on: () => () => {}, emit: () => {} },
  registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
    if (name === "powerline") commandHandler = options.handler;
  },
  registerShortcut() {
    throw new Error("the footer must not register shortcuts");
  },
};

powerline(pi as never);

async function fire(name: string, event: unknown = { type: name }): Promise<void> {
  for (const handler of handlers.get(name) ?? []) {
    await handler(event, ctx);
  }
}

function renderWidget(key: string, width: number): string[] {
  const factory = widgets.get(key);
  assert.ok(factory, `widget ${key} is installed`);
  const component = factory(tui, theme) as { render(width: number): string[] };
  return component.render(width);
}

function renderEditor(width: number): string[] {
  assert.ok(currentEditorFactory, "an editor factory is installed");
  const editor = currentEditorFactory(tui, {}, {});
  return editor.render(width);
}

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

// ── session start ──────────────────────────────────────────────────────────
await fire("session_start", { type: "session_start", reason: "startup" });
assert.ok(footerFactory, "footer installed");
const footer = footerFactory(tui, theme, footerData) as { render(width: number): string[] };
assert.deepEqual(footer.render(120), [], "the bar lives in the editor border, not in the footer rows");

// ── the bar is drawn in the editor's top border ────────────────────────────
const wide = renderEditor(200);
assert.equal(wide.length, 3, "the editor keeps its own box");
const topBorder = stripAnsi(wide[0]!);
assert.match(topBorder, /Sonnet 4\.5/, "model in the border");
assert.match(topBorder, /556\.6k/, "input totals include every usage entry");
assert.match(topBorder, /24k/, "output totals include the toolResult usage");
assert.match(topBorder, /6\.5M/, "cache read totals");
assert.match(topBorder, /12k/, "cache write totals");
assert.match(topBorder, /92\.0%/, "cache hit rate from the newest assistant message");
assert.match(topBorder, /\$0\.19/, "billed cost is usage.cost.total, never recomputed");
assert.match(topBorder, /\(sub\)/, "subscription keeps the amount");
assert.match(topBorder, /288k\/1M/, "native context estimate");
assert.match(topBorder, /refactor-footer/, "session name is shown");
assert.match(topBorder, /CI ok/, "extension statuses are rendered");
assert.equal(visibleWidth(wide[0]!), 200, "the border still spans the terminal");
assert.equal(wide[1], " > " + " ".repeat(196) + " ", "the prompt row is untouched");
assert.equal(wide[2], "─".repeat(200), "the bottom border is untouched");

// ── re-installing (session_start fires again on reload) must not double-wrap ─
await fire("session_start", { type: "session_start", reason: "reload" });
const afterReload = stripAnsi(renderEditor(200)[0]!);
assert.equal(afterReload.split("Sonnet 4.5").length - 1, 1, "the bar is drawn once after a reload");
assert.equal(visibleWidth(renderEditor(200)[0]!), 200, "still a single border line");

// ── after a compaction pi reports null context ─────────────────────────────
contextTokens = null;
contextPercent = null;
await fire("session_compact");
assert.match(stripAnsi(renderEditor(200)[0]!), /\?\/1M/, "unknown context renders as ?/window");

// ── narrow terminal keeps both rows ────────────────────────────────────────
const narrow = renderEditor(46);
assert.equal(visibleWidth(narrow[0]!), 46, "the border never overflows");
assert.ok(renderWidget("powerline-secondary", 46).length > 0, "overflow goes to the secondary row");

// ── corners and scroll indicators survive ──────────────────────────────────
currentEditorFactory = createCornerEditor;
await fire("session_start", { type: "session_start", reason: "reload" });
const cornered = stripAnsi(renderEditor(120)[0]!);
assert.ok(cornered.startsWith("╭") && cornered.endsWith("╮"), "corners are preserved");

currentEditorFactory = createScrollEditor;
await fire("session_start", { type: "session_start", reason: "reload" });
const scrolled = stripAnsi(renderEditor(120)[0]!);
assert.match(scrolled, /↑ 2 more/, "pi's scroll indicator survives");
assert.equal(visibleWidth(renderEditor(120)[0]!), 120, "scroll border still spans the terminal");

// ── an editor without a border falls back to the widget row ────────────────
currentEditorFactory = createBorderlessEditor;
await fire("session_start", { type: "session_start", reason: "reload" });
const borderless = renderEditor(120);
assert.equal(borderless.length, 1, "borderless editor is left alone");
assert.ok(renderWidget("powerline-top", 120).length > 0, "the bar falls back to the widget row");

// ── statuses widget shows notification-style statuses only ─────────────────
assert.deepEqual(renderWidget("powerline-status", 80), []);

// ── invalidation asks the TUI for a repaint (debounced) ────────────────────
await fire("turn_end");
await new Promise((resolve) => setTimeout(resolve, 60));
assert.ok(renders > 0, "renders were requested");

// ── toggle off restores the previous editor and clears the widgets ─────────
await commandHandler!("", ctx);
assert.equal(widgets.size, 0, "toggle off removes the widgets");
assert.equal(currentEditorFactory, createBorderlessEditor, "toggle off restores the previous editor");

await commandHandler!("", ctx);
assert.ok(widgets.has("powerline-top"), "toggle on reinstalls the widgets");
assert.notEqual(currentEditorFactory, createBorderlessEditor, "toggle on reinstalls the editor wrapper");

// ── unknown preset lists the available ones without touching settings ──────
await commandHandler!("nope", ctx);
assert.ok(notifications.some((message) => message.includes("native-parity")));

await fire("session_shutdown", { type: "session_shutdown", reason: "quit" });

console.log("wiring: ok");
