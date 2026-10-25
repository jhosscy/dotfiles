import { spawn } from "node:child_process";
import { sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

type SshConfig = { remote: string; remoteCwd: string; port?: number };

const SSH_OPTIONS = [
  "-o", "BatchMode=yes",
  "-o", "ForwardAgent=no",
  "-o", "ControlMaster=auto",
  "-o", `ControlPath=${process.env.HOME ?? "/tmp"}/.ssh/pi-ssh-control-%r@%h:%p`,
  "-o", "ControlPersist=60s",
] as const;

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.env($|\.)/,
  /credentials?/i,
  /secrets?/i,
];

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseSshArg(arg: string): SshConfig | { remote: string; remoteCwd?: undefined } {
  const match = arg.match(/^([^:]+):(.+)$/);
  if (!match) return { remote: arg };
  return { remote: match[1], remoteCwd: match[2] };
}

function hasCliFlag(name: string): boolean {
  const flag = `--${name}`;
  return process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function mapToRemotePath(path: string, localCwd: string, remoteCwd: string): string {
  if (path === localCwd) return remoteCwd;
  const prefix = localCwd.endsWith(sep) ? localCwd : `${localCwd}${sep}`;
  if (path.startsWith(prefix)) return `${remoteCwd}/${path.slice(prefix.length)}`;
  return path;
}

function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sshExec(remote: string, command: string, options: { signal?: AbortSignal; timeoutMs?: number; input?: Buffer; port?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [...SSH_OPTIONS];
    if (options.port) args.push("-p", String(options.port));
    args.push(remote, command);
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;

    const onAbort = () => child.kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (data) => chunks.push(data as Buffer));
    child.stderr.on("data", (data) => errChunks.push(data as Buffer));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) return reject(new Error("aborted"));
      if (timedOut) return reject(new Error("timeout"));
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().trim();
        return reject(new Error(`SSH failed (${code}): ${stderr}`));
      }
      resolve(Buffer.concat(chunks));
    });

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

function createRemoteReadOps(remote: string, remoteCwd: string, localCwd: string, port?: number): ReadOperations {
  const toRemote = (path: string) => mapToRemotePath(path, localCwd, remoteCwd);
  const opts = port ? { port } : {};
  return {
    readFile: (path) => sshExec(remote, `cat ${shQuote(toRemote(path))}`, opts),
    access: (path) => sshExec(remote, `test -r ${shQuote(toRemote(path))}`, opts).then(() => {}),
    detectImageMimeType: async (path) => {
      try {
        const result = await sshExec(remote, `file --mime-type -b ${shQuote(toRemote(path))}`, opts);
        const mime = result.toString().trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime) ? mime : null;
      } catch {
        return null;
      }
    },
  };
}

function createRemoteWriteOps(remote: string, remoteCwd: string, localCwd: string, port?: number): WriteOperations {
  const toRemote = (path: string) => mapToRemotePath(path, localCwd, remoteCwd);
  const opts = port ? { port } : {};
  return {
    writeFile: async (path, content) => {
      await sshExec(remote, `cat > ${shQuote(toRemote(path))}`, { input: Buffer.from(content), ...opts });
    },
    mkdir: (dir) => sshExec(remote, `mkdir -p ${shQuote(toRemote(dir))}`, opts).then(() => {}),
  };
}

function createRemoteEditOps(remote: string, remoteCwd: string, localCwd: string, port?: number): EditOperations {
  const readOps = createRemoteReadOps(remote, remoteCwd, localCwd, port);
  const writeOps = createRemoteWriteOps(remote, remoteCwd, localCwd, port);
  return { readFile: readOps.readFile, access: readOps.access, writeFile: writeOps.writeFile };
}

function createRemoteBashOps(remote: string, remoteCwd: string, localCwd: string, port?: number): BashOperations {
  const toRemote = (path: string) => mapToRemotePath(path, localCwd, remoteCwd);
  return {
    exec: (command, cwd, { onData, signal, timeout }) =>
      new Promise((resolve, reject) => {
        const remoteCommand = `cd ${shQuote(toRemote(cwd))} && ${command}`;
        const args = [...SSH_OPTIONS];
        if (port) args.push("-p", String(port));
        args.push(remote, remoteCommand);
        const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
        let timedOut = false;
        const timer = timeout
          ? setTimeout(() => {
              timedOut = true;
              child.kill();
            }, timeout * 1000)
          : undefined;

        const onAbort = () => child.kill();
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (error) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code ?? 1 });
        });
      }),
  };
}

export default function sshRemoteExtension(pi: ExtensionAPI) {
  pi.registerFlag("ssh", {
    description: "Run built-in read/write/edit/bash tools over SSH: user@host or user@host:/path",
    type: "string",
  });
  pi.registerFlag("ssh-port", {
    description: "SSH port for --ssh (default: 22)",
    type: "string",
  });

  const localCwd = process.cwd();
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);
  const sshFlagPresent = hasCliFlag("ssh");
  let resolvedSsh: SshConfig | null = null;
  let remoteReadTool: ReturnType<typeof createReadTool> | null = null;
  let remoteWriteTool: ReturnType<typeof createWriteTool> | null = null;
  let remoteEditTool: ReturnType<typeof createEditTool> | null = null;
  let remoteBashTool: ReturnType<typeof createBashTool> | null = null;
  let remoteBashOps: BashOperations | null = null;

  // Register tool overrides synchronously during extension load only when the
  // process was started with --ssh. This avoids conflicting with other read
  // overrides such as perf-tools during normal local sessions.
  if (sshFlagPresent) {
    pi.registerTool({
      ...localRead,
      async execute(id, params, signal, onUpdate) {
        const ssh = resolvedSsh;
        if (!ssh) return localRead.execute(id, params, signal, onUpdate);
        if (!remoteReadTool) {
          remoteReadTool = createReadTool(localCwd, { operations: createRemoteReadOps(ssh.remote, ssh.remoteCwd, localCwd, ssh.port) });
        }
        return remoteReadTool.execute(id, params, signal, onUpdate);
      },
    });

    pi.registerTool({
      ...localWrite,
      async execute(id, params, signal, onUpdate) {
        const ssh = resolvedSsh;
        if (!ssh) return localWrite.execute(id, params, signal, onUpdate);
        if (!remoteWriteTool) {
          remoteWriteTool = createWriteTool(localCwd, { operations: createRemoteWriteOps(ssh.remote, ssh.remoteCwd, localCwd, ssh.port) });
        }
        return remoteWriteTool.execute(id, params, signal, onUpdate);
      },
    });

    pi.registerTool({
      ...localEdit,
      async execute(id, params, signal, onUpdate) {
        const ssh = resolvedSsh;
        if (!ssh) return localEdit.execute(id, params, signal, onUpdate);
        if (!remoteEditTool) {
          remoteEditTool = createEditTool(localCwd, { operations: createRemoteEditOps(ssh.remote, ssh.remoteCwd, localCwd, ssh.port) });
        }
        return remoteEditTool.execute(id, params, signal, onUpdate);
      },
    });

    pi.registerTool({
      ...localBash,
      async execute(id, params, signal, onUpdate) {
        const ssh = resolvedSsh;
        if (!ssh) return localBash.execute(id, params, signal, onUpdate);
        if (!remoteBashTool) {
          remoteBashOps = createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd, ssh.port);
          remoteBashTool = createBashTool(localCwd, { operations: remoteBashOps });
        }
        return remoteBashTool.execute(id, params, signal, onUpdate);
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const arg = pi.getFlag("ssh") as string | undefined;
    if (!arg) {
      resolvedSsh = null;
      remoteReadTool = null;
      remoteWriteTool = null;
      remoteEditTool = null;
      remoteBashTool = null;
      remoteBashOps = null;
      try {
        ctx.ui.setStatus("ssh", undefined);
      } catch {
        // The previous ctx can become stale during reload/session replacement.
      }
      return;
    }

    const parsed = parseSshArg(arg);
    const portArg = pi.getFlag("ssh-port") as string | undefined;
    const port = portArg ? Number(portArg) : undefined;
    if (portArg && !Number.isFinite(port)) {
      resolvedSsh = null;
      try {
        ctx.ui.setStatus("ssh", ctx.ui.theme.fg("error", "SSH: invalid port"));
        if (ctx.hasUI) ctx.ui.notify(`SSH setup failed: invalid port ${portArg}`, "error");
      } catch {
        // Ignore stale ctx during reload/session replacement.
      }
      return;
    }

    let remoteCwd: string;
    try {
      remoteCwd = parsed.remoteCwd ?? (await sshExec(parsed.remote, "pwd", { timeoutMs: 10_000, port })).toString().trim();
    } catch (error) {
      resolvedSsh = null;
      try {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.setStatus("ssh", ctx.ui.theme.fg("error", "SSH: connection failed"));
        if (ctx.hasUI) ctx.ui.notify(`SSH setup failed: ${message}`, "error");
      } catch {
        // Ignore stale ctx during reload/session replacement.
      }
      return;
    }

    resolvedSsh = { remote: parsed.remote, remoteCwd, port };
    remoteReadTool = createReadTool(localCwd, { operations: createRemoteReadOps(resolvedSsh.remote, resolvedSsh.remoteCwd, localCwd, resolvedSsh.port) });
    remoteWriteTool = createWriteTool(localCwd, { operations: createRemoteWriteOps(resolvedSsh.remote, resolvedSsh.remoteCwd, localCwd, resolvedSsh.port) });
    remoteEditTool = createEditTool(localCwd, { operations: createRemoteEditOps(resolvedSsh.remote, resolvedSsh.remoteCwd, localCwd, resolvedSsh.port) });
    remoteBashOps = createRemoteBashOps(resolvedSsh.remote, resolvedSsh.remoteCwd, localCwd, resolvedSsh.port);
    remoteBashTool = createBashTool(localCwd, { operations: remoteBashOps });

    try {
      ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`));
      if (ctx.hasUI) ctx.ui.notify(`SSH mode: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`, "info");
    } catch {
      // Ignore stale ctx during reload/session replacement.
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!resolvedSsh) return undefined;

    if (event.toolName === "bash") {
      const input = event.input as { command?: unknown };
      if (typeof input.command !== "string" || !isSensitivePath(input.command)) return undefined;
      if (ctx.hasUI) ctx.ui.notify(`Blocked sensitive path in SSH bash command: ${input.command}`, "warning");
      return { block: true, reason: `Sensitive path is blocked in SSH mode: ${input.command}` };
    }

    if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string" || !isSensitivePath(input.path)) return undefined;

    if (ctx.hasUI) ctx.ui.notify(`Blocked sensitive path over SSH: ${input.path}`, "warning");
    return { block: true, reason: `Sensitive path is blocked in SSH mode: ${input.path}` };
  });

  pi.on("user_bash", () => {
    const ssh = resolvedSsh;
    if (!ssh) return undefined;
    if (!remoteBashOps) remoteBashOps = createRemoteBashOps(ssh.remote, ssh.remoteCwd, localCwd, ssh.port);
    return { operations: remoteBashOps };
  });

  pi.on("before_agent_start", async (event) => {
    const ssh = resolvedSsh;
    if (!ssh) return undefined;
    // Mutate structured prompt options (preferred by pi 1.3.0) instead of
    // replacing the whole prompt, so Pi can emit a transcript delta.
    event.systemPromptOptions.cwd = ssh.remoteCwd;
    const guideline = `All file and shell operations execute on remote host ${ssh.remote} over SSH; paths are remote paths. Local-only CLIs/skills are not available in this mode.`;
    if (!event.systemPromptOptions.promptGuidelines.includes(guideline)) {
      event.systemPromptOptions.promptGuidelines.push(guideline);
    }
    return undefined;
  });

  pi.registerCommand("ssh-status", {
    description: "Show SSH remote execution status",
    handler: async (_args, ctx) => {
      const agent = process.env.SSH_AUTH_SOCK ? "available" : "not detected";
      const status = resolvedSsh
        ? `SSH active\nRemote: ${resolvedSsh.remote}\nPath: ${resolvedSsh.remoteCwd}\nSSH_AUTH_SOCK: ${agent}\nForwardAgent: disabled for tool commands`
        : `SSH inactive\nUse: pi --ssh user@host or pi --ssh user@host:/path\nSSH_AUTH_SOCK: ${agent}`;
      ctx.ui.notify(status, resolvedSsh ? "info" : "warning");
    },
  });
}
