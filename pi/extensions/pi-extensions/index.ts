/**
 * Unified pi extensions bundle.
 *
 * This is a single entrypoint that imports and loads all extensions.
 * Benefits:
 * - pi's native loader only processes ONE file instead of N
 * - jiti transpiles ONE file (this one) instead of N
 * - Sub-extensions are loaded by Node/Bun's module system (cached)
 * - Factories run in parallel via Promise.all for fast startup
 *
 * To enable/disable an extension, toggle the `enabled` flag below.
 * To add a new extension, add the import and entry to EXTENSIONS.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ============================================================
// Extension imports
// ============================================================

// Providers (async factories - need await for model discovery)
import commandcodeProvider from "./pi-commandcode-provider/index.ts";
import tokenrouterProvider from "./pi-tokenrouter-provider/index.ts";
import mimoProvider from "./pi-mimo-provider/index.ts";

// UI/Editor extensions (sync factories)
import powerlineFooter from "./pi-powerline-footer/index.ts";
import vimEditor from "./pi-vim-editor/index.ts";
import permissionGate from "./permission-gate.ts";
import protectedPaths from "./protected-paths.ts";

// ============================================================
// Extension registry
// ============================================================

interface ExtensionEntry {
  name: string;
  factory: (pi: ExtensionAPI) => void | Promise<void>;
  enabled: boolean;
  /** "provider" = async, registers custom model providers (load first) */
  /** "ui" = sync, UI/TUI components (load second) */
  phase: "provider" | "ui";
}

const EXTENSIONS: ExtensionEntry[] = [
  // Phase 1: Providers (async, must complete before model registry is used)
  {
    name: "commandcode-provider",
    factory: commandcodeProvider,
    enabled: true,
    phase: "provider",
  },
  {
    name: "tokenrouter-provider",
    factory: tokenrouterProvider,
    enabled: true,
    phase: "provider",
  },
  {
    name: "mimo-provider",
    factory: mimoProvider,
    enabled: true,
    phase: "provider",
  },

  // Phase 2: UI/Editor extensions (sync or async, independent)
  {
    name: "powerline-footer",
    factory: powerlineFooter,
    enabled: true,
    phase: "ui",
  },
  {
    name: "vim-editor",
    factory: vimEditor,
    enabled: true,
    phase: "ui",
  },
  {
    name: "permission-gate",
    factory: permissionGate,
    enabled: true,
    phase: "ui",
  },
  {
    name: "protected-paths",
    factory: protectedPaths,
    enabled: true,
    phase: "ui",
  },
];

// ============================================================
// Main entrypoint
// ============================================================

export default async function (pi: ExtensionAPI): Promise<void> {
  const enabled = EXTENSIONS.filter((ext) => ext.enabled);

  if (enabled.length === 0) {
    return;
  }

  // Phase 1: Providers load in parallel (they all do async model discovery)
  const providers = enabled.filter((ext) => ext.phase === "provider");
  if (providers.length > 0) {
    await Promise.all(providers.map((ext) => ext.factory(pi)));
  }

  // Phase 2: UI extensions load in parallel (most are sync, but safe to await)
  const uiExts = enabled.filter((ext) => ext.phase === "ui");
  if (uiExts.length > 0) {
    await Promise.all(uiExts.map((ext) => ext.factory(pi)));
  }
}
