/**
 * Working-tree status (staged/unstaged/untracked/ahead/behind).
 *
 * The branch itself is not probed here: pi's `ReadonlyFooterDataProvider`
 * already watches `.git/HEAD` (worktrees and reftable included) and exposes
 * `getGitBranch()` / `onBranchChange()`. This module only adds the dirty state
 * pi does not expose, asynchronously, with a cache and a plain Node child
 * process.
 */
import { execFile } from "node:child_process";

export type GitPollingMode = "full" | "branch" | "off";

export interface GitDirtyStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export const EMPTY_GIT_DIRTY: GitDirtyStatus = {
  staged: 0,
  unstaged: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
};

/**
 * Parse `git status --porcelain=2 --branch` output.
 *
 * Header lines carry branch info (`# branch.head`, `# branch.ab`), file entries
 * are `1`/`2` (ordinary/rename), `u` (unmerged), `?` (untracked) and `!`
 * (ignored).
 */
export function parseGitStatusPorcelainV2(output: string): GitDirtyStatus {
  const status: GitDirtyStatus = { ...EMPTY_GIT_DIRTY };
  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        status.ahead = Number.parseInt(match[1]!, 10);
        status.behind = Number.parseInt(match[2]!, 10);
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    if (line.startsWith("? ")) {
      status.untracked++;
      continue;
    }
    if (line.startsWith("u ")) {
      // Unmerged: needs both a stage and a worktree resolution.
      status.staged++;
      status.unstaged++;
      continue;
    }
    // v2 entries start with "1 " / "2 ", v1 fallback with the XY pair itself.
    const offset = line.startsWith("1 ") || line.startsWith("2 ") ? 2 : 0;
    const x = line[offset];
    const y = line[offset + 1];
    if (x && x !== " " && x !== "." && x !== "?" && x !== "!") {
      status.staged++;
    }
    if (y && y !== " " && y !== "." && y !== "!") {
      status.unstaged++;
    }
  }
  return status;
}

export interface GitStatusTrackerOptions {
  /** How long a probe result is reused. Dirty state is not urgent. */
  ttlMs?: number;
  /** Hard timeout for the probe. */
  timeoutMs?: number;
  /** Called after a background probe updates the cache. */
  onChange?: () => void;
}

export interface GitStatusTracker {
  /** Cached dirty state for `cwd`. Never blocks; refreshes in the background. */
  get(cwd: string, mode: GitPollingMode): GitDirtyStatus;
  /** Drop the cached state so the next `get()` probes again. */
  invalidate(cwd?: string): void;
  dispose(): void;
}

const DEFAULT_TTL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 2000;

export function createGitStatusTracker(options: GitStatusTrackerOptions = {}): GitStatusTracker {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = new Map<string, { status: GitDirtyStatus; at: number }>();
  const inFlight = new Set<string>();
  let disposed = false;

  function probe(cwd: string): void {
    if (disposed || inFlight.has(cwd)) return;
    inFlight.add(cwd);
    execFile(
      "git",
      ["status", "--porcelain=2", "--branch"],
      { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        inFlight.delete(cwd);
        if (disposed) return;
        // Not a repo, git missing, or timed out: cache the empty state so the
        // probe backs off instead of respawning on every frame.
        const status = error ? { ...EMPTY_GIT_DIRTY } : parseGitStatusPorcelainV2(stdout);
        cache.set(cwd, { status, at: Date.now() });
        options.onChange?.();
      },
    );
  }

  return {
    get(cwd, mode) {
      // "branch" and "off" never spawn: the branch comes from pi's watcher.
      if (mode !== "full") return EMPTY_GIT_DIRTY;
      const cached = cache.get(cwd);
      if (!cached || Date.now() - cached.at >= ttlMs) {
        probe(cwd);
      }
      return cached?.status ?? EMPTY_GIT_DIRTY;
    },
    invalidate(cwd) {
      if (cwd) {
        cache.delete(cwd);
      } else {
        cache.clear();
      }
    },
    dispose() {
      disposed = true;
      cache.clear();
      inFlight.clear();
    },
  };
}
