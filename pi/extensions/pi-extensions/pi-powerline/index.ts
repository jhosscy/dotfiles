/**
 * pi-powerline: a powerline status line for pi.
 *
 * This extension owns the footer and nothing else: model, thinking level,
 * context, usage, cache hit rate, cost, subscription, git and extension
 * statuses. It never recomputes billed cost and never invents session state -
 * everything comes from pi's own accounting (`ctx.getContextUsage()`,
 * `ctx.sessionManager`, `ctx.model`, `ReadonlyFooterDataProvider`) through a
 * cached `NativeSnapshot`.
 *
 * Editor, stash, prompt history and welcome are deliberately out of scope.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { createEditorBarFactory, type EditorBarState, type EditorFactoryLike } from "./editor-bar.js";
import { getPreset, PRESETS } from "./presets.js";
import {
  collectHiddenExtensionStatusKeys,
  getNotificationExtensionStatuses,
  mergeSegmentOptions,
  parsePowerlineConfig,
  type PowerlineConfig,
} from "./powerline-config.js";
import { createGitStatusTracker, type GitPollingMode } from "./git.js";
import { readSettings, writePresetSetting } from "./settings.js";
import { buildSegmentContext, createSnapshotCache } from "./snapshot.js";
import { computeLayout } from "./status-layout.js";
import { createSubCoreBridge } from "./subscription.js";
import { fg, getDefaultColors, setThemeOverrides } from "./theme.js";
import type { StatusLinePreset } from "./types.js";

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];
const STATUS_RENDER_DEBOUNCE_MS = 33;
const DEFAULT_CONFIG: PowerlineConfig = { preset: "default", customItems: [], segmentOptions: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreset(value: unknown): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const preset = value.trim().toLowerCase();
  return PRESET_NAMES.includes(preset as StatusLinePreset) ? (preset as StatusLinePreset) : null;
}

function isStaleContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("This extension instance is stale");
}

export default function powerline(pi: ExtensionAPI) {
  let enabled = true;
  let config: PowerlineConfig = { ...DEFAULT_CONFIG };
  let preset: StatusLinePreset = "default";
  let autoCompactEnabled = true;
  let sessionStartTime = Date.now();

  let ctxRef: ExtensionContext | null = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let tuiRef: TUI | null = null;
  let themeRef: Theme | null = null;
  let unsubscribeBranch: (() => void) | null = null;
  let previousEditorFactory: EditorFactoryLike | undefined;
  let ourEditorFactory: EditorFactoryLike | undefined;

  // Assumed true until an editor renders without a top border, so the fallback
  // widget does not double-draw the bar on the first frame.
  const barState: EditorBarState = { attached: true };

  let invalidation = 0;
  let layoutCache: { key: string; top: string; secondary: string } | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshotCache = createSnapshotCache();
  const subCore = createSubCoreBridge(pi);
  const git = createGitStatusTracker({ onChange: () => invalidate() });

  function requestRender(delayMs = STATUS_RENDER_DEBOUNCE_MS): void {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      tuiRef?.requestRender();
    }, delayMs);
  }

  function invalidate(delayMs?: number): void {
    invalidation++;
    layoutCache = null;
    requestRender(delayMs);
  }

  function gitMode(): GitPollingMode {
    // Preset defaults plus user overrides, the same options the segments see.
    const options = mergeSegmentOptions(getPreset(preset).segmentOptions, config.segmentOptions);
    return options.git?.polling ?? "full";
  }

  function currentColors() {
    return getPreset(preset).colors ?? getDefaultColors();
  }

  function loadConfig(ctx: ExtensionContext): void {
    const settings = readSettings(ctx.cwd);
    config = parsePowerlineConfig(settings.powerline, PRESET_NAMES);
    preset = config.preset;
    setThemeOverrides(
      isRecord(settings.powerline)
        ? { colors: settings.powerline.colors, icons: settings.powerline.icons }
        : undefined,
    );
    const compaction = isRecord(settings.compaction) ? settings.compaction : undefined;
    autoCompactEnabled = compaction?.enabled !== false;
  }

  function renderLayout(
    width: number,
    theme: Theme,
    align: "left" | "right" = "right",
  ): { top: string; secondary: string } {
    const ctx = ctxRef;
    const footerData = footerDataRef;
    if (!enabled || !ctx || !footerData) return { top: "", secondary: "" };
    const key = `${width}|${invalidation}|${align}`;
    if (layoutCache?.key === key) return layoutCache;

    const presetDef = getPreset(preset);
    const snapshot = snapshotCache.get(ctx, invalidation);
    const mode = gitMode();
    const segmentCtx = buildSegmentContext({
      snapshot,
      config,
      preset,
      theme,
      footerData,
      git: {
        branch: footerData.getGitBranch(),
        ...git.get(ctx.cwd, mode),
      },
      subscriptionUsage: subCore.get(),
      autoCompactEnabled,
      sessionStartTime,
    });
    const layout = computeLayout(segmentCtx, presetDef, config.customItems, width, { align });
    layoutCache = { key, top: layout.top, secondary: layout.secondary };
    return layoutCache;
  }

  /** Bar for the editor's top border: one flowing row, left aligned. */
  function renderBorderBar(width: number): string | null {
    if (!themeRef) return null;
    return renderLayout(width, themeRef, "left").top || null;
  }

  function installUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;
      themeRef = theme;
      footerDataRef = footerData;
      unsubscribeBranch?.();
      // pi already watches .git/HEAD (worktrees and reftable included); reuse it
      // instead of running a second branch watcher.
      unsubscribeBranch = footerData.onBranchChange(() => {
        git.invalidate(ctx.cwd);
        invalidate();
      });
      return {
        dispose() {
          unsubscribeBranch?.();
          unsubscribeBranch = null;
          footerDataRef = null;
          tuiRef = null;
        },
        invalidate() {
          invalidate();
        },
        render() {
          return [];
        },
      };
    });

    // Notification-style statuses ("[name] ...") go above the editor, like pi.
    ctx.ui.setWidget(
      "powerline-status",
      () => ({
        dispose() {},
        invalidate() {
          invalidate();
        },
        render(width: number): string[] {
          if (!enabled || !footerDataRef) return [];
          const statuses = footerDataRef.getExtensionStatuses();
          if (statuses.size === 0) return [];
          const hidden = collectHiddenExtensionStatusKeys(config.customItems);
          const lines: string[] = [];
          for (const value of getNotificationExtensionStatuses(statuses, hidden)) {
            const line = ` ${value}`;
            if (visibleWidth(line) <= width) lines.push(line);
          }
          return lines;
        },
      }),
      { placement: "aboveEditor" },
    );

    // The bar lives in the editor's top border. Wrapping the editor keeps the
    // box, the prompt and pi's working state intact, and composes with any
    // editor another extension installed (pi-vim-editor included).
    // Capture the base factory immutably: re-installing (session_start fires
    // again on reload) must never make the wrapper wrap itself.
    const currentFactory = ctx.ui.getEditorComponent?.() ?? undefined;
    if (currentFactory !== ourEditorFactory) {
      previousEditorFactory = currentFactory;
    }
    const factory = createEditorBarFactory(previousEditorFactory, {
      renderBar: (width) => renderBorderBar(width),
      border: (text) => (themeRef ? fg(themeRef, "border", text, currentColors()) : text),
      state: barState,
    });
    ourEditorFactory = factory;
    ctx.ui.setEditorComponent(factory);

    // Fallback for editors that draw no top border: show the row as a widget
    // instead of losing it. With a normal box this renders nothing.
    ctx.ui.setWidget(
      "powerline-top",
      (tui, theme) => ({
        dispose() {},
        invalidate() {
          layoutCache = null;
        },
        render(width: number): string[] {
          tuiRef = tui;
          themeRef = theme;
          if (barState.attached) return [];
          try {
            const { top } = renderLayout(width, theme);
            return top ? [top] : [];
          } catch (error) {
            if (!isStaleContextError(error)) throw error;
            ctxRef = null;
            return [];
          }
        },
      }),
      { placement: "aboveEditor" },
    );

    ctx.ui.setWidget(
      "powerline-secondary",
      (tui, theme) => ({
        dispose() {},
        invalidate() {
          layoutCache = null;
        },
        render(width: number): string[] {
          tuiRef = tui;
          try {
            const { secondary } = renderLayout(width, theme);
            return secondary ? [secondary] : [];
          } catch (error) {
            if (!isStaleContextError(error)) throw error;
            ctxRef = null;
            return [];
          }
        },
      }),
      { placement: "belowEditor" },
    );
  }

  function clearUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent(previousEditorFactory);
    previousEditorFactory = undefined;
    ourEditorFactory = undefined;
    ctx.ui.setFooter(undefined);
    ctx.ui.setWidget("powerline-top", undefined);
    ctx.ui.setWidget("powerline-secondary", undefined);
    ctx.ui.setWidget("powerline-status", undefined);
    unsubscribeBranch?.();
    unsubscribeBranch = null;
    footerDataRef = null;
    tuiRef = null;
    themeRef = null;
    barState.attached = true;
    layoutCache = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    sessionStartTime = Date.now();
    loadConfig(ctx);
    snapshotCache.reset();
    git.invalidate();
    invalidate(0);
    if (enabled) {
      installUi(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    unsubscribeBranch?.();
    unsubscribeBranch = null;
    ctxRef = null;
    footerDataRef = null;
    tuiRef = null;
    layoutCache = null;
    snapshotCache.reset();
    git.invalidate();
  });

  // ── Snapshot invalidation ────────────────────────────────────────────────

  pi.on("message_end", async () => invalidate());
  pi.on("turn_end", async () => invalidate());
  pi.on("agent_end", async (_event, ctx) => {
    ctxRef = ctx;
    invalidate();
  });
  pi.on("session_compact", async (_event, ctx) => {
    ctxRef = ctx;
    invalidate();
  });
  pi.on("session_tree", async (_event, ctx) => {
    ctxRef = ctx;
    invalidate();
  });
  pi.on("session_info_changed", async () => invalidate());
  pi.on("model_select", async (_event, ctx) => {
    ctxRef = ctx;
    invalidate();
  });
  pi.on("thinking_level_select", async () => invalidate());

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      git.invalidate(ctx.cwd);
    }
    invalidate();
  });

  // A `!` command can change the working tree or check out another branch.
  pi.on("user_bash", async (_event, ctx) => {
    git.invalidate(ctx.cwd);
    invalidate();
  });

  // ── Command ──────────────────────────────────────────────────────────────

  pi.registerCommand("powerline", {
    description: "Configure the powerline status line (toggle, preset)",
    getArgumentCompletions: (prefix) => {
      const query = prefix.trimStart().toLowerCase();
      const items = PRESET_NAMES.filter((name) => name.startsWith(query)).map((name) => ({
        value: name,
        label: name,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      ctxRef = ctx;
      const requested = args?.trim();
      if (!requested) {
        enabled = !enabled;
        if (enabled) {
          installUi(ctx);
          invalidate(0);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          clearUi(ctx);
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }
      const next = normalizePreset(requested);
      if (!next) {
        ctx.ui.notify(`Available presets: ${PRESET_NAMES.join(", ")}`, "info");
        return;
      }
      preset = next;
      config = { ...config, preset: next };
      invalidate(0);
      ctx.ui.notify(
        writePresetSetting(next, ctx.cwd)
          ? `Preset set to: ${next}`
          : `Preset set to: ${next} (not persisted; check settings.json)`,
        "info",
      );
    },
  });
}
