import type { GitStatus } from "./types.js";

interface CachedGitData {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  timestamp: number;
  pendingFetch: Promise<void> | null;
}

const CACHE_TTL_MS = 1000;
const dataCacheByCwd = new Map<string, CachedGitData>();
let invalidationCounter = 0;

/**
 * Parse git status --porcelain=2 --branch output.
 *
 * v2 format (Git 2.11+) gives branch info and file status in one shot.
 *
 * Header lines:
 *   # branch.oid <sha>            — current commit SHA
 *   # branch.head <name>          — branch name (absent when detached)
 *   # branch.upstream <remote>
 *   # branch.ab +<ahead> -<behind>
 *
 * File entries:
 *   1 <XY> …  — ordinary entry
 *   2 <XY> …  — rename/copy
 *   u <XY> …  — unmerged (conflict)
 *   ? <path>  — untracked
 *   ! <path>  — ignored
 */
function parseGitPorcelainV2(output: string): {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
} {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      branch = line.slice(14);
    } else if (line.startsWith("# branch.oid ")) {
      // Detached HEAD — capture short SHA if no branch.head is present
      if (!branch) {
        branch = line.slice(14, 21) + " (detached)";
      }
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = Number.parseInt(m[1], 10);
        behind = Number.parseInt(m[2], 10);
      }
    } else if (!line.startsWith("#")) {
      // File entries
      if (line.startsWith("? ")) {
        untracked++;
        continue;
      }
      if (line.startsWith("u ")) {
        // Unmerged — counts as both staged and unstaged (needs resolution)
        staged++;
        unstaged++;
        continue;
      }
      // Ordinary v2 ("1 …" / "2 …") or v1 fallback ("XY …")
      const xyOffset = line.startsWith("1 ") || line.startsWith("2 ") ? 2 : 0;
      const x = line[xyOffset];
      const y = line[xyOffset + 1];
      // In v2, "." = unmodified (same as space in v1)
      if (x && x !== " " && x !== "." && x !== "?" && x !== "!") {
        staged++;
      }
      if (y && y !== " " && y !== "." && y !== "!") {
        unstaged++;
      }
    }
  }

  return { branch, staged, unstaged, untracked, ahead, behind };
}

function fetchGitData(cwd: string, timeoutMs = 500): Promise<string | null> {
  const proc = Bun.spawn(["git", "status", "--porcelain=2", "--branch"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  return proc.stdout
    .text()
    .then((text) => text.trim() || null)
    .catch(() => null);
}

/**
 * Get git status with caching (stale-while-revalidate pattern).
 *
 * Returns the last known value immediately while refreshing in background.
 * Designed for synchronous render() calls in the powerline footer.
 */
export function getGitStatus(providerBranch: string | null, cwd = process.cwd()): GitStatus {
  const now = Date.now();
  const cached = dataCacheByCwd.get(cwd);

  // Return cached if fresh
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return {
      branch: cached.branch,
      staged: cached.staged,
      unstaged: cached.unstaged,
      untracked: cached.untracked,
      ahead: cached.ahead,
      behind: cached.behind,
    };
  }

  // Trigger background fetch if not already pending
  if (!cached?.pendingFetch) {
    const fetchId = invalidationCounter;
    const pendingFetch = fetchGitData(cwd).then((raw) => {
      const current = dataCacheByCwd.get(cwd);
      if (fetchId === invalidationCounter) {
        if (raw !== null) {
          const parsed = parseGitPorcelainV2(raw);
          dataCacheByCwd.set(cwd, {
            ...parsed,
            timestamp: Date.now(),
            pendingFetch: null,
          });
        } else {
          // Not a repo, git not installed, or timed out — mark as empty with fresh timestamp
          dataCacheByCwd.set(cwd, {
            branch: providerBranch,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            ahead: 0,
            behind: 0,
            timestamp: Date.now(),
            pendingFetch: null,
          });
        }
      } else if (current) {
        // Our fetch is stale, just release the lock
        current.pendingFetch = null;
      }
    });

    dataCacheByCwd.set(cwd, {
      branch: cached?.branch ?? providerBranch,
      staged: cached?.staged ?? 0,
      unstaged: cached?.unstaged ?? 0,
      untracked: cached?.untracked ?? 0,
      ahead: cached?.ahead ?? 0,
      behind: cached?.behind ?? 0,
      timestamp: cached?.timestamp ?? 0,
      pendingFetch,
    });
  }

  // Return stale or fallback
  if (cached) {
    return {
      branch: cached.branch,
      staged: cached.staged,
      unstaged: cached.unstaged,
      untracked: cached.untracked,
      ahead: cached.ahead,
      behind: cached.behind,
    };
  }

  return { branch: providerBranch, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
}

/**
 * Convenience accessor that delegates to the unified cache.
 */
export function getCurrentBranch(providerBranch: string | null, cwd = process.cwd()): string | null {
  return getGitStatus(providerBranch, cwd).branch;
}

/**
 * Force refresh git data on next render (e.g. after file writes).
 */
export function invalidateGitStatus(cwd?: string): void {
  if (cwd) {
    dataCacheByCwd.delete(cwd);
  } else {
    dataCacheByCwd.clear();
  }
  invalidationCounter++;
}

/**
 * Backward-compatible alias for invalidateGitStatus.
 */
export function invalidateGitBranch(cwd?: string): void {
  invalidateGitStatus(cwd);
}
