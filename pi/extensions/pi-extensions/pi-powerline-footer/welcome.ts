import { basename } from "node:path";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth as tuiTruncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ansi, fgOnly, getFgAnsiCode } from "./colors.js";

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedResources {
  contextFiles: string[];
  extensions: string[];
  skills: string[];
  promptTemplates: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared rendering utilities
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "██████████    ",
  "████  ████    ",
  "████  ████    ",
  "████████  ████",
  "████      ████",
  "████      ████",
];

const GRADIENT_COLORS = [
  "\x1b[38;5;199m",
  "\x1b[38;5;171m",
  "\x1b[38;5;135m",
  "\x1b[38;5;99m",
  "\x1b[38;5;75m",
  "\x1b[38;5;51m",
];

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function dim(text: string): string {
  return getFgAnsiCode("sep") + text + ansi.reset;
}

function gradientLine(line: string): string {
  const reset = ansi.reset;
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1) colorIdx++;
    const char = line[i];
    if (char !== " ") {
      result += GRADIENT_COLORS[colorIdx] + char + reset;
    } else {
      result += char;
    }
  }
  return result;
}

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return tuiTruncateToWidth(text, width, "…");
  if (visLen === width) return text;
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function fitToWidth(str: string, width: number): string {
  const visLen = visibleWidth(str);
  if (visLen > width) return tuiTruncateToWidth(str, width, "…");
  return str + " ".repeat(width - visLen);
}

function getWelcomeBoxWidth(termWidth: number): number {
  const minLayoutWidth = 44;
  if (termWidth < minLayoutWidth) return 0;
  return Math.max(minLayoutWidth, termWidth - 2);
}

interface WelcomeData {
  modelName: string;
  providerName: string;
  recentSessions: RecentSession[];
  loadedResources: LoadedResources;
}

function buildLeftColumn(data: WelcomeData, colWidth: number): string[] {
  const logoColored = PI_LOGO.map((line) => gradientLine(line));
  
  return [
    "",
    centerText(bold("Welcome back!"), colWidth),
    "",
    ...logoColored.map((l) => centerText(l, colWidth)),
    "",
    centerText(fgOnly("model", data.modelName), colWidth),
    centerText(dim(data.providerName), colWidth),
  ];
}

function formatResourceItems(items: string[], maxLines: number, colWidth: number): string[] {
  const indent = "  ";
  const availableWidth = Math.max(1, colWidth - 1 - visibleWidth(indent));
  const rawLines: string[][] = [];
  let current: string[] = [];
  let consumed = 0;

  for (const item of items) {
    if (rawLines.length >= maxLines) break;
    const candidate = [...current, item].join(" · ");
    if (visibleWidth(candidate) <= availableWidth) {
      current.push(item);
      consumed++;
      continue;
    }
    if (current.length > 0) {
      rawLines.push(current);
      current = [];
      if (rawLines.length >= maxLines) break;
    }
    current = [item];
    consumed++;
  }

  if (current.length > 0 && rawLines.length < maxLines) {
    rawLines.push(current);
  }

  const lines = rawLines.map((lineItems) =>
    ` ${dim(indent)}${lineItems.map((item) => fgOnly("path", item)).join(dim(" · "))}`,
  );
  const remaining = Math.max(0, items.length - consumed);
  if (remaining > 0) {
    lines.push(` ${dim(`${indent}+${remaining} more`)}`);
  }
  return lines;
}

function buildResourceSection(label: string, items: string[], maxLines: number, colWidth: number): string[] {
  if (items.length === 0) return [];
  return [
    ` ${bold(label)} ${dim("(")}${fgOnly("gitClean", String(items.length))}${dim(")")}`,
    ...formatResourceItems(items, maxLines, colWidth),
  ];
}

function buildRightColumn(data: WelcomeData, colWidth: number): string[] {
  const hChar = "─";
  const separator = ` ${dim(hChar.repeat(colWidth - 2))}`;
  
  const sessionLines: string[] = [];
  if (data.recentSessions.length === 0) {
    sessionLines.push(` ${dim("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions.slice(0, 5)) {
      sessionLines.push(
        ` ${dim("• ")}${fgOnly("path", session.name)}${dim(` (${session.timeAgo})`)}`,
      );
    }
  }

  const { contextFiles, extensions, skills, promptTemplates } = data.loadedResources;
  const loadedLines = [
    ...buildResourceSection("Skills", skills, 3, colWidth),
    ...buildResourceSection("Extensions", extensions, 3, colWidth),
    ...buildResourceSection("Prompts", promptTemplates, 3, colWidth),
    ...buildResourceSection("Context", contextFiles, 1, colWidth),
  ];
  if (loadedLines.length === 0) {
    loadedLines.push(` ${dim("No loaded resources detected")}`);
  }
  
  return [
    ` ${bold(fgOnly("accent", "Loaded resources"))}`,
    ...loadedLines,
    separator,
    ` ${bold(fgOnly("accent", "Recent sessions"))}`,
    ...sessionLines,
    "",
  ];
}

function renderWelcomeBox(
  data: WelcomeData, 
  termWidth: number, 
  bottomLine: string,
): string[] {
  // Minimum width for two-column layout: leftCol(26) + separator(3) + minRightCol(15) = 44
  const minLayoutWidth = 44;
  
  // If terminal is too narrow for the layout, return empty (skip welcome box)
  if (termWidth < minLayoutWidth) {
    return [];
  }
  
  const boxWidth = getWelcomeBoxWidth(termWidth);
  const leftCol = 26;
  const rightCol = Math.max(1, boxWidth - leftCol - 3); // Ensure rightCol is at least 1
  
  const hChar = "─";
  const v = dim("│");
  const tl = dim("╭");
  const tr = dim("╮");
  const bl = dim("╰");
  const br = dim("╯");
  
  const leftLines = buildLeftColumn(data, leftCol);
  const rightLines = buildRightColumn(data, rightCol);
  
  const lines: string[] = [];
  
  // Top border with title
  const title = " pi agent ";
  const titlePrefix = dim(hChar.repeat(3));
  const titleStyled = titlePrefix + fgOnly("model", title);
  const titleVisLen = 3 + visibleWidth(title);
  const afterTitle = boxWidth - 2 - titleVisLen;
  const afterTitleText = afterTitle > 0 ? dim(hChar.repeat(afterTitle)) : "";
  lines.push(tl + titleStyled + afterTitleText + tr);
  
  // Content rows
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const left = fitToWidth(leftLines[i] ?? "", leftCol);
    const right = fitToWidth(rightLines[i] ?? "", rightCol);
    lines.push(v + left + v + right + v);
  }
  
  // Bottom border
  lines.push(bl + bottomLine + br);
  
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Welcome Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Welcome overlay component for pi agent.
 * Displays a branded splash screen with logo and loaded resource details.
 */
export class WelcomeComponent implements Component {
  private data: WelcomeData;
  private countdown: number = 30;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedResources: LoadedResources = { contextFiles: [], extensions: [], skills: [], promptTemplates: [] },
  ) {
    this.data = { modelName, providerName, recentSessions, loadedResources };
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) {
      return [];
    }
    
    const boxWidth = getWelcomeBoxWidth(termWidth);
    
    // Bottom line with countdown
    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = dim(countdownText);
    const bottomContentWidth = boxWidth - 2;
    const countdownVisLen = visibleWidth(countdownText);
    const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
    const rightPad = bottomContentWidth - countdownVisLen - leftPad;
    const hChar = "─";
    const bottomLine = dim(hChar.repeat(Math.max(0, leftPad))) + 
      countdownStyled + 
      dim(hChar.repeat(Math.max(0, rightPad)));
    
    return renderWelcomeBox(this.data, termWidth, bottomLine);
  }
}

/**
 * Welcome header - same layout as overlay but persistent (no countdown).
 * Used when quietStartup: true.
 */
export class WelcomeHeader implements Component {
  private data: WelcomeData;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedResources: LoadedResources = { contextFiles: [], extensions: [], skills: [], promptTemplates: [] },
  ) {
    this.data = { modelName, providerName, recentSessions, loadedResources };
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) {
      return [];
    }
    
    const boxWidth = getWelcomeBoxWidth(termWidth);
    const hChar = "─";
    
    // Bottom line with column separator (leftCol=26, rightCol=boxWidth-29)
    const leftCol = 26;
    const rightCol = Math.max(1, boxWidth - leftCol - 3);
    const bottomLine = dim(hChar.repeat(leftCol)) + dim("┴") + dim(hChar.repeat(rightCol));
    
    const lines = renderWelcomeBox(this.data, termWidth, bottomLine);
    if (lines.length > 0) {
      lines.push(""); // Add empty line for spacing only if we rendered content
    }
    return lines;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery functions
// ═══════════════════════════════════════════════════════════════════════════

const loggedDiscoveryErrors = new Set<string>();

function logDiscoveryError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${scope}:${message}`;
  if (loggedDiscoveryErrors.has(key)) {
    return;
  }
  loggedDiscoveryErrors.add(key);
  if (loggedDiscoveryErrors.size > 500) {
    loggedDiscoveryErrors.clear();
  }
  console.debug(`[powerline-welcome] ${scope}:`, error);
}

type PiResourceAPI = Pick<ExtensionAPI, "getCommands" | "getAllTools">;

function compactResourceLabel(pathOrName: string): string {
  const normalized = pathOrName.replace(/\\/g, "/").replace(/\/(index\.(ts|js))$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function addResourceLabel(target: Set<string>, label: unknown): void {
  if (typeof label !== "string") return;
  const trimmed = label.trim();
  if (!trimmed) return;
  target.add(compactResourceLabel(trimmed));
}

function labelFromSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed || trimmed === "local" || trimmed === "cli" || trimmed === "auto") {
    return null;
  }
  if (trimmed.startsWith("npm:")) {
    const body = trimmed.slice(4);
    const versionIndex = body.lastIndexOf("@");
    return versionIndex > 0 ? body.slice(0, versionIndex) : body;
  }
  if (trimmed.startsWith("git:")) {
    const body = trimmed.slice(4);
    const withoutRef = body.split("@")[0] ?? body;
    const parts = withoutRef.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? withoutRef;
  }
  return compactResourceLabel(trimmed);
}

function addSourceLabel(target: Set<string>, sourceInfo: { path?: unknown; source?: unknown } | undefined): void {
  if (typeof sourceInfo?.source === "string") {
    const label = labelFromSource(sourceInfo.source);
    if (label) {
      addResourceLabel(target, label);
      return;
    }
  }
  addResourceLabel(target, sourceInfo?.path);
}

/**
 * Discover loaded resource labels from Pi's native registries.
 *
 * Pi's interactive mode renders the authoritative loaded-resource listing from
 * its ResourceLoader. Extensions do not get direct ResourceLoader access during
 * session_start, but they can read Pi's native command/tool registries via
 * getCommands() and getAllTools(). This intentionally avoids filesystem
 * re-discovery so counts reflect resources Pi actually registered instead of
 * files that merely exist on disk.
 */
export function discoverLoadedCounts(pi?: PiResourceAPI): LoadedResources {
  const contextFiles = new Set<string>(); // Not exposed to extensions at startup; Pi shows the exact native list separately.
  const extensions = new Set<string>();
  const skills = new Set<string>();
  const promptTemplates = new Set<string>();

  try {
    for (const command of pi?.getCommands?.() ?? []) {
      if (command.source === "extension") {
        addSourceLabel(extensions, command.sourceInfo);
      } else if (command.source === "skill") {
        addResourceLabel(skills, command.name.replace(/^skill:/, ""));
      } else if (command.source === "prompt") {
        addResourceLabel(promptTemplates, command.name.replace(/^\//, ""));
      }
    }
  } catch (error) {
    logDiscoveryError("Failed to read Pi command registry", error);
  }

  try {
    for (const tool of pi?.getAllTools?.() ?? []) {
      const sourceInfo = tool.sourceInfo;
      if (!sourceInfo || sourceInfo.source === "builtin" || sourceInfo.source === "sdk") {
        continue;
      }
      addSourceLabel(extensions, sourceInfo);
    }
  } catch (error) {
    logDiscoveryError("Failed to read Pi tool registry", error);
  }

  return {
    contextFiles: [...contextFiles].sort((a, b) => a.localeCompare(b)),
    extensions: [...extensions].sort((a, b) => a.localeCompare(b)),
    skills: [...skills].sort((a, b) => a.localeCompare(b)),
    promptTemplates: [...promptTemplates].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Get recent sessions using Pi's native session index.
 */
export async function getRecentSessions(maxCount: number = 3): Promise<RecentSession[]> {
  try {
    const sessions = await SessionManager.listAll();
    if (sessions.length === 0) return [];

    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    const seen = new Set<string>();
    const recent: RecentSession[] = [];
    const now = Date.now();

    for (const session of sessions) {
      const shortCwd = session.cwd ? basename(session.cwd) : "";

      const displayName = shortCwd

      if (seen.has(displayName)) continue;
      seen.add(displayName);
      recent.push({
        name: displayName,
        timeAgo: formatTimeAgo(now - session.modified.getTime()),
      });
      if (recent.length >= maxCount) break;
    }

    return recent;
  } catch (error) {
    logDiscoveryError("Failed to list recent sessions", error);
    return [];
  }
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
