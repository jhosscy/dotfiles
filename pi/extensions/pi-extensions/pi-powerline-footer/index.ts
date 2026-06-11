import {
  CustomEditor,
  copyToClipboard,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type SelectItem, SelectList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ColorScheme, SegmentContext, StatusLinePreset } from "./types.js";
import type { PowerlineConfig } from "./powerline-config.js";
import { getPreset, PRESETS } from "./presets.js";
import { collectHiddenExtensionStatusKeys, getNotificationExtensionStatuses, mergeSegmentOptions, parsePowerlineConfig } from "./powerline-config.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.js";
import { createWelcomeDismissScheduler } from "./welcome-dismiss.ts";
import { createRenderScheduler } from "./render-scheduler.ts";
import { readCoreContextUsage } from "./context-usage.ts";
import { getDefaultColors } from "./theme.js";
import { collectSessionMetrics, emptySessionMetrics, type SessionMetrics } from "./session-metrics.ts";
import { readRecentProjectPrompts } from "./prompt-history.ts";
import { computeResponsiveLayout } from "./status-layout.ts";
import { detectCustomCompactionEnabled, getSessionsPath, getStashHistoryPath, readSettings, resolveShortcutConfig, writePowerlinePresetSetting } from "./powerline-settings.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

let config: PowerlineConfig = {
  preset: "default",
  customItems: [],
  segmentOptions: {},
};

const CUSTOM_COMPACTION_STATUS_KEY = "compact-policy";
let customCompactionEnabled = false;

const STASH_HISTORY_LIMIT = 12;
const PROJECT_PROMPT_HISTORY_LIMIT = 50;
const STASH_PREVIEW_WIDTH = 72;
const PROMPT_HISTORY_LIMIT = 100;
const LAYOUT_CACHE_TTL_MS = 250;
const STREAMING_LAYOUT_CACHE_TTL_MS = 1000;
const STATUS_RENDER_DEBOUNCE_MS = 33;
const EDITOR_STATUS_DEFER_MS = 150;
const PROMPT_HISTORY_TRACKED = Symbol.for("powerlinePromptHistoryTracked");
const PROMPT_HISTORY_STATE_KEY = Symbol.for("powerlinePromptHistoryState");

type PromptHistoryState = { savedPromptHistory: string[] };

type SubCoreRateWindow = {
  label: string;
  usedPercent: number;
  resetDescription?: string;
  resetAt?: string;
};

type SubCoreUsageSnapshot = {
  provider: string;
  windows: SubCoreRateWindow[];
  error?: { message: string };
};

type SubCoreEntry = {
  provider: string;
  usage?: SubCoreUsageSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromptHistoryState(value: unknown): value is PromptHistoryState {
  return isRecord(value)
    && Array.isArray(value.savedPromptHistory)
    && value.savedPromptHistory.every((entry) => typeof entry === "string");
}

function getPromptHistoryState(): PromptHistoryState {
  const existing = Reflect.get(globalThis, PROMPT_HISTORY_STATE_KEY);
  if (isPromptHistoryState(existing)) {
    return existing;
  }

  const state: PromptHistoryState = { savedPromptHistory: [] };
  Reflect.set(globalThis, PROMPT_HISTORY_STATE_KEY, state);
  return state;
}

function readPromptHistory(editor: any): string[] {
  const history = editor?.history;
  if (!Array.isArray(history)) return [];

  const normalized: string[] = [];
  for (const entry of history) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (normalized.length > 0 && normalized[normalized.length - 1] === trimmed) continue;
    normalized.push(trimmed);
    if (normalized.length >= PROMPT_HISTORY_LIMIT) break;
  }

  return normalized;
}

function snapshotPromptHistory(editor: any): void {
  const history = readPromptHistory(editor);
  if (history.length > 0) {
    getPromptHistoryState().savedPromptHistory = [...history];
  }
}

function restorePromptHistory(editor: any): void {
  const { savedPromptHistory } = getPromptHistoryState();
  if (!savedPromptHistory.length || typeof editor?.addToHistory !== "function") return;

  for (let i = savedPromptHistory.length - 1; i >= 0; i--) {
    editor.addToHistory(savedPromptHistory[i]);
  }
}

function trackPromptHistory(editor: any): void {
  if (!editor || typeof editor.addToHistory !== "function") return;
  if (editor[PROMPT_HISTORY_TRACKED]) {
    snapshotPromptHistory(editor);
    return;
  }

  const originalAddToHistory = editor.addToHistory.bind(editor);
  editor.addToHistory = (text: string) => {
    originalAddToHistory(text);
    snapshotPromptHistory(editor);
  };
  editor[PROMPT_HISTORY_TRACKED] = true;
  snapshotPromptHistory(editor);
}

function normalizeStashHistoryEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const history: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    if (!hasNonWhitespaceText(entry)) {
      continue;
    }

    if (history[history.length - 1] === entry) {
      continue;
    }

    history.push(entry);
    if (history.length >= STASH_HISTORY_LIMIT) {
      break;
    }
  }

  return history;
}

function readPersistedStashHistory(): string[] {
  const stashHistoryPath = getStashHistoryPath();

  try {
    if (!existsSync(stashHistoryPath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(stashHistoryPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Ignoring invalid stash history at ${stashHistoryPath}`);
      return [];
    }

    return normalizeStashHistoryEntries(parsed.history);
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read stash history from ${stashHistoryPath}:`, error);
    return [];
  }
}

function persistStashHistory(history: string[]): void {
  const stashHistoryPath = getStashHistoryPath();
  const payload = {
    version: 1,
    history: history.slice(0, STASH_HISTORY_LIMIT),
  };

  try {
    mkdirSync(dirname(stashHistoryPath), { recursive: true });
    writeFileSync(stashHistoryPath, JSON.stringify(payload, null, 2) + "\n");
  } catch (error) {
    console.debug(`[powerline-footer] Failed to persist stash history to ${stashHistoryPath}:`, error);
  }
}

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];

function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function normalizePreset(value: unknown): StatusLinePreset | null {
  if (typeof value !== "string") {
    return null;
  }

  const preset = value.trim().toLowerCase();
  return isValidPreset(preset) ? preset : null;
}

function hasNonWhitespaceText(text: string): boolean {
  return text.trim().length > 0;
}

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("This extension instance is stale");
}

function getCurrentEditorText(ctx: any, editor: any): string {
  // Prefer the live editor text. The custom editor may temporarily report an
  // empty string while it is being re-initialized (e.g. after a session
  // switch), so fall back to Pi's own editor text in that case so stash /
  // copy / history actions still see the user's input.
  const editorText = editor?.getExpandedText?.();
  if (typeof editorText === "string" && editorText.length > 0) return editorText;
  if (typeof ctx?.ui?.getEditorText === "function") return ctx.ui.getEditorText();
  return editorText ?? "";
}

function buildStashPreview(text: string, maxWidth: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty)";
  return truncateToWidth(compact, maxWidth, "…");
}

function pushStashHistory(history: string[], text: string): boolean {
  if (!hasNonWhitespaceText(text)) return false;
  if (history[0] === text) return false;

  history.unshift(text);
  if (history.length > STASH_HISTORY_LIMIT) {
    history.length = STASH_HISTORY_LIMIT;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function powerlineFooter(pi: ExtensionAPI) {
  const startupSettings = readSettings();
  config = parsePowerlineConfig(startupSettings.powerline, PRESET_NAMES);
  const resolvedShortcuts = resolveShortcutConfig(startupSettings);

  let enabled = true;
  let sessionStartTime = Date.now();
  let sessionGeneration = 0;
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let isStreaming = false;
  let tuiRef: any = null;
  let dismissWelcomeOverlay: (() => void) | null = null;
  let welcomeHeaderActive = false;
  let welcomeOverlayShouldDismiss = false;
  let lastUserPrompt = "";
  let showLastPrompt = true;
  let stashedEditorText: string | null = null;
  let stashedPromptHistory: string[] = readPersistedStashHistory();
  type EditorFactory = (tui: any, theme: any, keybindings: any) => any;
  let currentEditor: any = null;
  let previousEditorFactory: EditorFactory | undefined;
  let powerlineEditorFactory: EditorFactory | undefined;
  let currentModelId: string | null = null;
  let modelChangedAt = 0;
  let sessionMetrics: SessionMetrics = emptySessionMetrics();
  let subscriptionUsage: SubCoreUsageSnapshot | undefined;
  
  // Cache for the top and secondary powerline widgets.
  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;
  let layoutDirty = true;
  let lastEditorInputAt = 0;

  const welcomeDismissScheduler = createWelcomeDismissScheduler({
    dismiss: (ctx: unknown) => dismissWelcome(ctx),
    getGeneration: () => sessionGeneration,
    isEnabled: () => enabled,
  });

  const statusRenderScheduler = createRenderScheduler(() => {
    const msSinceInput = Date.now() - lastEditorInputAt;
    if (layoutDirty && msSinceInput < EDITOR_STATUS_DEFER_MS) {
      statusRenderScheduler.schedule(Math.max(0, EDITOR_STATUS_DEFER_MS - msSinceInput));
      return;
    }

    tuiRef?.requestRender();
  }, STATUS_RENDER_DEBOUNCE_MS);

  const resetLayoutCache = () => {
    lastLayoutResult = null;
    layoutDirty = true;
  };

  const requestStatusRender = (delayMs?: number) => {
    layoutDirty = true;
    statusRenderScheduler.schedule(delayMs);
  };

  const refreshSessionMetrics = (ctx: any) => {
    sessionMetrics = collectSessionMetrics(ctx, modelChangedAt);
  };

  function updateSubscriptionUsage(usage: SubCoreUsageSnapshot | undefined): void {
    subscriptionUsage = usage;
    if (currentCtx) {
      resetLayoutCache();
      requestStatusRender();
    }
  }

  pi.events.on("sub-core:update-all", (payload: unknown) => {
    const state = (payload as { state?: { provider?: string; entries?: SubCoreEntry[] } }).state;
    if (!state?.provider || !state.entries) return;
    updateSubscriptionUsage(state.entries.find((entry) => entry.provider === state.provider)?.usage);
  });

  pi.events.on("sub-core:update-current", (payload: unknown) => {
    const state = (payload as { state?: { usage?: SubCoreUsageSnapshot } }).state;
    updateSubscriptionUsage(state?.usage);
  });

  pi.events.on("sub-core:ready", (payload: unknown) => {
    const state = (payload as { state?: { usage?: SubCoreUsageSnapshot } }).state;
    updateSubscriptionUsage(state?.usage);
  });

  function overlaySelectListTheme(theme: Theme) {
    return {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    };
  }

  async function showSelectOverlay(
    ctx: any,
    title: string,
    hint: string,
    items: SelectItem[],
    maxVisible: number,
  ): Promise<SelectItem | null> {
    return ctx.ui.custom<SelectItem | null>(
      (tui: any, theme: Theme, _keybindings: any, done: (result: SelectItem | null) => void) => {
        const selectList = new SelectList(items, maxVisible, overlaySelectListTheme(theme));
        const border = (text: string) => theme.fg("dim", text);
        const wrapRow = (text: string, innerWidth: number): string => {
          return `${border("│")}${truncateToWidth(text, innerWidth, "…", true)}${border("│")}`;
        };

        selectList.onSelect = (item) => done(item);
        selectList.onCancel = () => done(null);

        return {
          render: (width: number) => {
            const innerWidth = Math.max(1, width - 2);
            const lines: string[] = [];

            lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
            lines.push(wrapRow(theme.fg("accent", theme.bold(title)), innerWidth));
            lines.push(border(`├${"─".repeat(innerWidth)}┤`));

            for (const line of selectList.render(innerWidth)) {
              lines.push(wrapRow(line, innerWidth));
            }

            lines.push(border(`├${"─".repeat(innerWidth)}┤`));
            lines.push(wrapRow(theme.fg("dim", hint), innerWidth));
            lines.push(border(`╰${"─".repeat(innerWidth)}╯`));

            return lines;
          },
          invalidate: () => selectList.invalidate(),
          handleInput: (data: string) => {
            // j/k navigation (vim-style) — works independently of global
            // keybindings.json so it doesn't collide with ctrl+j/k or
            // Kitty protocol ambiguities (ctrl+j = \n = enter).
            if (data === "j") {
              selectList.setSelectedIndex(
                selectList["selectedIndex"] === selectList["filteredItems"].length - 1
                  ? 0
                  : (selectList["selectedIndex"] ?? 0) + 1,
              );
              tui.requestRender();
              return;
            }
            if (data === "k") {
              const len = selectList["filteredItems"].length;
              selectList.setSelectedIndex(
                selectList["selectedIndex"] === 0
                  ? len - 1
                  : (selectList["selectedIndex"] ?? 0) - 1,
              );
              tui.requestRender();
              return;
            }
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: () => ({
          verticalAlign: "center",
          horizontalAlign: "center",
        }),
      },
    );
  }

  // Track session start
  pi.on("session_start", async (event, ctx) => {
    sessionGeneration++;
    sessionStartTime = Date.now();
    currentCtx = ctx;
    currentModelId = ctx.model?.id ?? null;
    modelChangedAt = 0;
    refreshSessionMetrics(ctx);
    customCompactionEnabled = detectCustomCompactionEnabled(ctx.cwd);
    lastUserPrompt = "";
    isStreaming = false;
    stashedEditorText = null;

    const settings = readSettings(ctx.cwd);
    showLastPrompt = settings.showLastPrompt !== false;
    config = parsePowerlineConfig(settings.powerline, PRESET_NAMES);
    stashedPromptHistory = readPersistedStashHistory();

    getThinkingLevelFn = typeof ctx.getThinkingLevel === "function"
      ? () => ctx.getThinkingLevel()
      : null;

    if (ctx.hasUI) {
      ctx.ui.setStatus("stash", undefined);
    }
    
    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
      if (event.reason === "startup") {
        if (settings.quietStartup === true) {
          setupWelcomeHeader(ctx);
        } else {
          setupWelcomeOverlay(ctx);
        }
      } else {
        dismissWelcome(ctx);
      }
    }

  });

  pi.on("session_shutdown", async (event: any) => {
    // Switching sessions (resume/new/fork) replaces the context but keeps the
    // terminal alive, so extended keyboard modes (Kitty protocol,
    // modifyOtherKeys) should be preserved. Only a true terminal exit
    // (quit/reload) is allowed to tear those down.
    const isTerminalExit = event?.reason === "quit" || event?.reason === "reload";
    sessionGeneration++;
    dismissWelcomeOverlay?.();
    dismissWelcomeOverlay = null;
    welcomeHeaderActive = false;
    welcomeOverlayShouldDismiss = false;
    welcomeDismissScheduler.cancel();
    statusRenderScheduler.cancel();
    currentCtx = null;
    currentModelId = null;
    modelChangedAt = 0;
    sessionMetrics = emptySessionMetrics();
    subscriptionUsage = undefined;
    footerDataRef = null;
    getThinkingLevelFn = null;
    tuiRef = null;
    currentEditor = null;
    previousEditorFactory = undefined;
    powerlineEditorFactory = undefined;
    resetLayoutCache();
    void isTerminalExit; // reserved for future teardown of extended keyboard modes
  });

  // Check if a bash command might change git branch
  const mightChangeGitBranch = (cmd: string): boolean => {
    const gitBranchPatterns = [
      /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
      /\bgit\s+stash\s+(pop|apply)/,
    ];
    return gitBranchPatterns.some(p => p.test(cmd));
  };

  // Invalidate git status on file changes, trigger re-render on potential branch changes
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus(ctx.cwd);
    }
    // Check for bash commands that might change git branch
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        // Invalidate caches since working tree state changes with branch
        invalidateGitStatus(ctx.cwd);
        invalidateGitBranch(ctx.cwd);
        // Small delay to let git update, then re-render
        setTimeout(() => requestStatusRender(), 100);
      }
    }
  });

  // Also catch user escape commands (! prefix)
  // Note: This fires BEFORE execution, so we use a longer delay and multiple re-renders
  // to ensure we catch the update after the command completes.
  pi.on("user_bash", async (event) => {
    if (mightChangeGitBranch(event.command)) {
      // Invalidate immediately so next render fetches fresh data
      invalidateGitStatus(event.cwd);
      invalidateGitBranch(event.cwd);
      // Multiple staggered re-renders to catch fast and slow commands
      setTimeout(() => requestStatusRender(), 100);
      setTimeout(() => requestStatusRender(), 300);
      setTimeout(() => requestStatusRender(), 500);
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    const nextModelId = ctx.model?.id ?? null;
    if (currentModelId !== null && nextModelId !== currentModelId) {
      modelChangedAt = Date.now();
    }
    currentModelId = nextModelId;
    currentCtx = ctx;
    refreshSessionMetrics(ctx);
    requestStatusRender();
  });

  // Refresh footer immediately when thinking level changes (pi >= 0.70.2)
  pi.on("thinking_level_select", async () => {
    resetLayoutCache();
    requestStatusRender(0);
  });

  pi.on("session_compact", async (_event, ctx) => {
    currentCtx = ctx;
    refreshSessionMetrics(ctx);
    requestStatusRender();
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    refreshSessionMetrics(ctx);
    requestStatusRender();
  });

  // Track the last user prompt for the below-editor prompt hint.
  pi.on("before_agent_start", async (event) => {
    lastUserPrompt = event.prompt;
  });

  // Track streaming state (footer only shows status during streaming)
  // Also dismiss welcome when agent starts responding (handles `p "command"` case)
  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    dismissWelcome(ctx);
  });

  // Also dismiss welcome on tool calls (agent is working).
  pi.on("tool_call", async (_event, ctx) => {
    dismissWelcome(ctx);
  });

  function dismissWelcome(ctx: any) {
    welcomeDismissScheduler.cancel();

    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      // The startup overlay mounts after a delay; dismiss it immediately if it appears later.
      welcomeOverlayShouldDismiss = true;
    }
    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  }

  function scheduleDismissWelcome(ctx: any) {
    if (!dismissWelcomeOverlay && welcomeOverlayShouldDismiss && !welcomeHeaderActive) return;
    welcomeDismissScheduler.schedule(ctx);
  }

  function addStashHistoryEntry(text: string): void {
    const changed = pushStashHistory(stashedPromptHistory, text);
    if (!changed) {
      return;
    }

    persistStashHistory(stashedPromptHistory);
  }

  function copyTextToClipboard(ctx: any, text: string, successMessage?: string): void {
    copyToClipboard(text);
    if (successMessage) {
      ctx.ui.notify(successMessage, "info");
    }
  }

  function getEditorTextForClipboard(ctx: any): string | null {
    const text = getCurrentEditorText(ctx, currentEditor);
    if (hasNonWhitespaceText(text)) {
      return text;
    }

    ctx.ui.notify("Editor is empty", "info");
    return null;
  }

  async function selectStashedPromptFromHistory(ctx: any): Promise<string | null> {
    const historyItems = [...stashedPromptHistory];
    const items: SelectItem[] = historyItems.map((entry, index) => ({
      value: String(index),
      label: `#${index + 1} ${buildStashPreview(entry, STASH_PREVIEW_WIDTH)}`,
    }));

    const selected = await showSelectOverlay(
      ctx, "Stash history", "j/k navigate • enter insert • esc cancel",
      items, Math.min(items.length, 10));
    if (!selected) return null;

    const i = Number.parseInt(selected.value, 10);
    return historyItems[i] ?? null;
  }

  async function selectProjectPromptFromHistory(ctx: any, prompts: string[]): Promise<string | null> {
    const items: SelectItem[] = prompts.map((entry, index) => ({
      value: String(index),
      label: `#${index + 1} ${buildStashPreview(entry, STASH_PREVIEW_WIDTH)}`,
    }));

    const selected = await showSelectOverlay(
      ctx, "Recent project prompts", "j/k navigate • enter insert • esc cancel",
      items, Math.min(items.length, 10));
    if (!selected) return null;

    const i = Number.parseInt(selected.value, 10);
    return prompts[i] ?? null;
  }

  async function selectPromptHistorySource(
    ctx: any,
    stashCount: number,
    projectPromptCount: number,
  ): Promise<"stash" | "project" | null> {
    const items: SelectItem[] = [];

    if (stashCount > 0) {
      items.push({
        value: "stash",
        label: "Stashed prompts",
        description: `${stashCount} saved`,
      });
    }

    if (projectPromptCount > 0) {
      items.push({
        value: "project",
        label: "Recent project prompts",
        description: `${projectPromptCount} recent`,
      });
    }

    if (items.length === 0) {
      return null;
    }

    if (items.length === 1) {
      return items[0]?.value === "project" ? "project" : "stash";
    }

    const selected = await showSelectOverlay(
      ctx, "Prompt history", "j/k navigate • enter open • esc cancel",
      items, items.length);
    if (!selected) return null;

    return selected.value === "project" ? "project" : "stash";
  }

  async function insertSelectedPromptHistoryEntry(ctx: any, selected: string): Promise<void> {
    const currentText = getCurrentEditorText(ctx, currentEditor);
    if (!hasNonWhitespaceText(currentText)) {
      ctx.ui.setEditorText(selected);
      ctx.ui.notify("Inserted prompt", "info");
      return;
    }

    const action = await ctx.ui.select("Insert prompt", ["Replace", "Append", "Cancel"]);

    if (action === "Replace") {
      ctx.ui.setEditorText(selected);
      ctx.ui.notify("Replaced editor with prompt", "info");
      return;
    }

    if (action === "Append") {
      const separator = currentText.endsWith("\n") || selected.startsWith("\n") ? "" : "\n";
      ctx.ui.setEditorText(`${currentText}${separator}${selected}`);
      ctx.ui.notify("Appended prompt", "info");
    }
  }

  function stashOrRestoreEditorText(ctx: any): void {
    const rawText = getCurrentEditorText(ctx, currentEditor);
    const hasStash = stashedEditorText !== null;

    if (!hasNonWhitespaceText(rawText)) {
      if (!hasStash) {
        ctx.ui.notify("Nothing to stash", "info");
        return;
      }

      ctx.ui.setEditorText(stashedEditorText);
      stashedEditorText = null;
      ctx.ui.setStatus("stash", undefined);
      ctx.ui.notify("Stash restored", "info");
      return;
    }

    stashedEditorText = rawText;
    addStashHistoryEntry(rawText);
    ctx.ui.setEditorText("");
    ctx.ui.setStatus("stash", "stash");
    ctx.ui.notify(hasStash ? "Stash updated" : "Text stashed", "info");
  }

  async function openStashHistory(ctx: any): Promise<void> {
    let projectPrompts: string[] = [];

    try {
      projectPrompts = await readRecentProjectPrompts(getSessionsPath(), ctx.cwd, PROJECT_PROMPT_HISTORY_LIMIT);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to load project prompts: ${message}`, "warning");
    }

    if (stashedPromptHistory.length === 0 && projectPrompts.length === 0) {
      ctx.ui.notify("No prompt history yet", "info");
      return;
    }

    const source = await selectPromptHistorySource(ctx, stashedPromptHistory.length, projectPrompts.length);
    if (!source) {
      return;
    }

    const selected = source === "project"
      ? await selectProjectPromptFromHistory(ctx, projectPrompts)
      : await selectStashedPromptFromHistory(ctx);
    if (!selected) return;

    await insertSelectedPromptHistoryEntry(ctx, selected);
  }

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    currentCtx = ctx;
    refreshSessionMetrics(ctx);
    if (ctx.hasUI) {
      if (stashedEditorText !== null) {
        if (ctx.ui.getEditorText().trim() === "") {
          ctx.ui.setEditorText(stashedEditorText);
          stashedEditorText = null;
          ctx.ui.setStatus("stash", undefined);
          ctx.ui.notify("Stash restored", "info");
        } else {
          ctx.ui.notify("Stash preserved — clear editor then Alt+S to restore", "info");
        }
      }
    }
    requestStatusRender();
  });

  // Command to toggle/configure
  pi.registerCommand("powerline", {
    description: "Configure powerline status (toggle, preset)",
    getArgumentCompletions: (prefix) => {
      const presetPrefix = prefix.trimStart().toLowerCase();
      const items = Object.keys(PRESETS)
        .filter((preset) => preset.startsWith(presetPrefix))
        .map((preset) => ({ value: preset, label: preset }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      // Update context reference (command ctx may have more methods)
      currentCtx = ctx;
      
      if (!args?.trim()) {
        // Toggle
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          dismissWelcomeOverlay?.();
          dismissWelcomeOverlay = null;
          welcomeHeaderActive = false;
          welcomeOverlayShouldDismiss = false;
          welcomeDismissScheduler.cancel();
          getPromptHistoryState().savedPromptHistory = [];
          stashedEditorText = null;
          ctx.ui.setStatus("stash", undefined);
          // Clear all custom UI components
          restoreEditorComponent(ctx);
          ctx.ui.setFooter(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("powerline-top", undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          ctx.ui.setWidget("powerline-status", undefined);
          ctx.ui.setWidget("powerline-last-prompt", undefined);
          footerDataRef = null;
          tuiRef = null;
          currentEditor = null;
          statusRenderScheduler.cancel();
          resetLayoutCache();
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      const preset = normalizePreset(args);
      if (preset) {
        config.preset = preset;
        resetLayoutCache();
        if (enabled) {
          requestStatusRender(0);
        }

        if (writePowerlinePresetSetting(preset, ctx.cwd)) {
          ctx.ui.notify(`Preset set to: ${preset}`, "info");
        } else {
          ctx.ui.notify(`Preset set to: ${preset} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      // Show available presets
      const presetList = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${presetList}`, "info");
    },
  });

  pi.registerCommand("stash-history", {
    description: "Open prompt history picker",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      if (!enabled) {
        ctx.ui.notify("Powerline is disabled", "info");
        return;
      }

      await openStashHistory(ctx);
    },
  });

  pi.registerShortcut("alt+s", {
    description: "Stash/restore editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      stashOrRestoreEditorText(ctx);
    },
  });

  pi.registerShortcut(resolvedShortcuts.stashHistory, {
    description: "Open prompt history picker",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await openStashHistory(ctx);
    },
  });

  pi.registerShortcut(resolvedShortcuts.copyEditor, {
    description: "Copy full editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      const text = getEditorTextForClipboard(ctx);
      if (!text) return;

      copyTextToClipboard(ctx, text, "Copied editor text");
    },
  });

  pi.registerShortcut(resolvedShortcuts.cutEditor, {
    description: "Cut full editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;

      const text = getEditorTextForClipboard(ctx);
      if (!text) return;

      copyTextToClipboard(ctx, text);
      ctx.ui.setEditorText("");
      ctx.ui.notify("Cut editor text", "info");
    },
  });

  function getThinkingLevelFromSession(): string | null {
    if (!currentCtx) return null;
    const sessionEvents = currentCtx.sessionManager?.getBranch?.() ?? [];
    for (let i = sessionEvents.length - 1; i >= 0; i--) {
      const entry = sessionEvents[i];
      if (isRecord(entry) && entry.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
        return entry.thinkingLevel;
      }
    }
    return null;
  }

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const presetDef = getPreset(config.preset);
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    const { usageStats, responseModel } = sessionMetrics;
    // Prefer Pi's own context estimate (most accurate, e.g. for branch
    // summaries when navigating the session tree). Fall back to the
    // last persisted assistant usage for the active branch.
    const coreContextUsage = readCoreContextUsage(ctx);
    const contextTokens = coreContextUsage?.contextTokens ?? sessionMetrics.contextTokens;
    const contextWindow = coreContextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextPercent = coreContextUsage?.contextPercent
      ?? (contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0);

    const modelCost = {
      input: typeof ctx.model?.cost?.input === "number" ? ctx.model.cost.input : 0,
      output: typeof ctx.model?.cost?.output === "number" ? ctx.model.cost.output : 0,
      cacheRead: typeof ctx.model?.cost?.cacheRead === "number" ? ctx.model.cost.cacheRead : 0,
      cacheWrite: typeof ctx.model?.cost?.cacheWrite === "number" ? ctx.model.cost.cacheWrite : 0,
    };

    const segmentOptions = mergeSegmentOptions(presetDef.segmentOptions, config.segmentOptions);

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch, ctx.cwd, segmentOptions.git?.polling);
    const extensionStatuses = footerDataRef?.getExtensionStatuses() ?? new Map();
    const customItemsById = new Map(config.customItems.map((item) => [item.id, item]));
    const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    const thinkingLevel = getThinkingLevelFromSession() ?? getThinkingLevelFn?.() ?? "off";

    // Global cost across ALL branches (getEntries), not just active branch
    let globalCost: number | undefined;
    if (presetDef.segmentOptions?.cost?.mode === "global") {
      const allEntries = ctx.sessionManager?.getEntries?.() ?? [];
      globalCost = 0;
      for (const entry of allEntries) {
        if (entry.type !== "message") continue;
        const m = entry.message;
        if (m?.role !== "assistant") continue;
        if (m.stopReason === "error" || m.stopReason === "aborted") continue;
        globalCost += m.usage?.cost?.total ?? 0;
      }
    }

    return {
      model: ctx.model,
      thinkingLevel,
      sessionId: ctx.sessionManager?.getSessionId?.(),
      usageStats,
      globalCost,
      latestCacheHitRate: sessionMetrics.latestCacheHitRate,
      modelCost,
      contextPercent,
      contextTokens,
      contextWindow,
      responseModel,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      customCompactionEnabled: customCompactionEnabled || extensionStatuses.has(CUSTOM_COMPACTION_STATUS_KEY),
      usingSubscription,
      subscriptionUsage,
      sessionStartTime,
      git: gitStatus,
      extensionStatuses,
      hiddenExtensionStatusKeys,
      customItemsById,
      options: segmentOptions,
      theme,
      colors,
    };
  }

  /**
   * Get cached responsive layout or compute fresh one.
   * The segment context is cheap; cached session metrics are refreshed by lifecycle events.
   */
  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    const cacheTtl = isStreaming ? STREAMING_LAYOUT_CACHE_TTL_MS : LAYOUT_CACHE_TTL_MS;

    if (lastLayoutResult && lastLayoutWidth === width) {
      const msSinceInput = now - lastEditorInputAt;
      const typingRecently = msSinceInput < EDITOR_STATUS_DEFER_MS;

      if (typingRecently && (layoutDirty || now - lastLayoutTimestamp >= cacheTtl)) {
        return lastLayoutResult;
      }

      if (!layoutDirty && now - lastLayoutTimestamp < cacheTtl) {
        return lastLayoutResult;
      }
    }
    
    const presetDef = getPreset(config.preset);
    let segmentCtx: SegmentContext;
    try {
      segmentCtx = buildSegmentContext(currentCtx, theme);
    } catch (error) {
      // Pi replaces the extension context when sessions are resumed / forked /
      // created. The replacement is a one-frame race; swallow it and render
      // an empty footer this frame so the next event can rebuild cleanly.
      if (!isStaleExtensionContextError(error)) throw error;
      currentCtx = null;
      lastLayoutWidth = width;
      lastLayoutResult = { topContent: "", secondaryContent: "" };
      lastLayoutTimestamp = now;
      layoutDirty = false;
      return lastLayoutResult;
    }

    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, config.customItems, width);
    lastLayoutTimestamp = now;
    layoutDirty = false;

    return lastLayoutResult;
  }

  function restoreEditorComponent(ctx: any): void {
    if (typeof ctx.ui?.setEditorComponent === "function") {
      ctx.ui.setEditorComponent(previousEditorFactory);
    }
    previousEditorFactory = undefined;
    powerlineEditorFactory = undefined;
  }

  function setupCustomEditor(ctx: any) {
    snapshotPromptHistory(currentEditor);
    if (!enabled) {
      return;
    }

    // Compose with any previously installed custom editor so load order does not
    // matter. Capture the base factory immutably; re-installing powerline must
    // never make the powerline factory wrap itself.
    const currentFactory = ctx.ui.getEditorComponent?.();
    if (currentFactory !== powerlineEditorFactory) {
      previousEditorFactory = currentFactory;
    }
    const baseEditorFactory = previousEditorFactory;

    const powerlineFactory: EditorFactory = (tui: any, editorTheme: any, keybindings: any) => {
      const editor = baseEditorFactory
        ? baseEditorFactory(tui, editorTheme, keybindings)
        : new CustomEditor(tui, editorTheme, keybindings);

      currentEditor = editor;
      trackPromptHistory(editor);
      restorePromptHistory(editor);

      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        lastEditorInputAt = Date.now();
        scheduleDismissWelcome(ctx);
        originalHandleInput(data);
      };

      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) return originalRender(width);

        const bc = (s: string) => `${getFgAnsiCode("sep")}${s}${ansi.reset}`;
        const prompt = `${ansi.getFgAnsi(200, 200, 200)}>${ansi.reset}`;
        const promptPrefix = ` ${prompt} `;
        const contPrefix = "   ";
        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);
        if (lines.length === 0) return lines;

        let bottomBorderIndex = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i--) {
          const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = i;
            break;
          }
        }

        const bottomBorderStatus = (() => {
          const bottomLine = lines[bottomBorderIndex] ?? "";
          const stripped = bottomLine.replace(/\x1b\[[0-9;]*m/g, "");
          const match = stripped.match(/[^─]+$/);
          return match?.[0]?.trim() ? match[0] : "";
        })();
        const bottomBorder = (): string => {
          const line = " " + bc("─".repeat(width - 2));
          const statusWidth = visibleWidth(bottomBorderStatus);
          if (!bottomBorderStatus || statusWidth >= width) return line;
          return truncateToWidth(line, Math.max(0, width - statusWidth), "") + bottomBorderStatus;
        };

        const result: string[] = [" " + bc("─".repeat(width - 2))];
        for (let i = 1; i < bottomBorderIndex; i++) {
          result.push(`${i === 1 ? promptPrefix : contPrefix}${lines[i] || ""}`);
        }
        if (bottomBorderIndex === 1) {
          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
        }
        result.push(bottomBorder());
        for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
          result.push(lines[i] || "");
        }

        return result;
      };

      return editor;
    };

    powerlineEditorFactory = powerlineFactory;
    ctx.ui.setEditorComponent(powerlineFactory);

    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;
      const unsub = footerData.onBranchChange(() => requestStatusRender());

      return {
        dispose: unsub,
        invalidate() {
          requestStatusRender();
        },
        render(): string[] {
          return [];
        },
      };
    });

    ctx.ui.setWidget("powerline-status", () => {
      return {
        dispose() {},
        invalidate() {
          requestStatusRender();
        },
        render(width: number): string[] {
          if (!currentCtx || !footerDataRef) return [];

          const statuses = footerDataRef.getExtensionStatuses();
          if (!statuses || statuses.size === 0) return [];
          const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

          const notifications: string[] = [];
          for (const value of getNotificationExtensionStatuses(statuses, hiddenExtensionStatusKeys)) {
            const lineContent = ` ${value}`;
            if (visibleWidth(lineContent) <= width) {
              notifications.push(lineContent);
            }
          }

          return notifications;
        },
      };
    }, { placement: "aboveEditor" });

    ctx.ui.setWidget("powerline-top", (_tui: any, theme: Theme) => {
      return {
        dispose() {},
        invalidate() {
          resetLayoutCache();
        },
        render(width: number): string[] {
          if (!currentCtx) return [];

          const layout = getResponsiveLayout(width, theme);
          return layout.topContent ? [layout.topContent] : [];
        },
      };
    }, { placement: "aboveEditor" });

    ctx.ui.setWidget("powerline-secondary", (_tui: any, theme: Theme) => {
      return {
        dispose() {},
        invalidate() {
          resetLayoutCache();
        },
        render(width: number): string[] {
          if (!currentCtx) return [];

          const layout = getResponsiveLayout(width, theme);

          if (layout.secondaryContent) {
            return [layout.secondaryContent];
          }

          return [];
        },
      };
    }, { placement: "belowEditor" });

    ctx.ui.setWidget("powerline-last-prompt", () => {
      return {
        dispose() {},
        invalidate() {},
        render(width: number): string[] {
          if (!showLastPrompt || !lastUserPrompt) return [];

          const prefix = ` ${getFgAnsiCode("sep")}↳${ansi.reset} `;
          const availableWidth = width - visibleWidth(prefix);
          if (availableWidth < 10) return [];

          let promptText = lastUserPrompt.replace(/\s+/g, " ").trim();
          if (!promptText) return [];

          promptText = truncateToWidth(promptText, availableWidth, "…");

          const styledPrompt = `${getFgAnsiCode("sep")}${promptText}${ansi.reset}`;
          const line = `${prefix}${styledPrompt}`;
          return [truncateToWidth(line, width, "…")];
        },
      };
    }, { placement: "belowEditor" });
  }

  async function setupWelcomeHeader(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts(pi);
    const recentSessions = await getRecentSessions(4);
    
    const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);
    welcomeHeaderActive = true;
    
    ctx.ui.setHeader(() => {
      return {
        render(width: number): string[] {
          return header.render(width);
        },
        invalidate() {
          header.invalidate();
        },
      };
    });
  }

  async function setupWelcomeOverlay(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts(pi);
    const recentSessions = await getRecentSessions(3);
    
    const overlaySessionGeneration = sessionGeneration;

    // Small delay to let pi-mono finish initialization
    setTimeout(() => {
      if (!enabled || welcomeOverlayShouldDismiss || isStreaming || overlaySessionGeneration !== sessionGeneration) {
        welcomeOverlayShouldDismiss = false;
        return;
      }
      
      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((entry: unknown) => {
        if (!isRecord(entry)) return false;
        if (entry.type === "tool_call" || entry.type === "tool_result") return true;
        return entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant";
      });
      if (hasActivity) {
        return;
      }
      
      ctx.ui.custom(
        (tui: any, _theme: any, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(
            modelName,
            providerName,
            recentSessions,
            loadedCounts,
          );
          
          let countdown = 30;
          let dismissed = false;
          let interval: ReturnType<typeof setInterval> | null = null;
          
          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            if (interval) clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };
          
          interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);

          dismissWelcomeOverlay = dismiss;

          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }

          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: () => dismiss(),
            dispose: () => {
              dismissed = true;
              if (interval) clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
          }),
        },
      ).catch((error) => {
        console.debug("[powerline-footer] Welcome overlay failed:", error);
      });
    }, 100);
  }
}
