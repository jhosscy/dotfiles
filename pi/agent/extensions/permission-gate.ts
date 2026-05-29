/**
 * Permission Gate Extension
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const allowedForSession = new Set<string>();
  const isSubagent = Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0;
  let gateEnabled = true;

  pi.registerCommand("permissions", {
    description: "Toggle permission gate on/off",
    handler: async (_args, ctx) => {
      gateEnabled = !gateEnabled;
      ctx.ui.notify(
        `Permissions ${gateEnabled ? "enabled" : "disabled"}`,
        gateEnabled ? "info" : "warning",
      );
    },
  });

	pi.on("tool_call", async (event, ctx) => {
    if (!gateEnabled) return;
    if (event.toolName === "bash") {
      const command = event.input.command as string;
      const dangerousPatterns = [
         /\brm\s+(-rf?|--recursive)/i,
         /\bsudo\b/i,
         /\b(chmod|chown)\b.*777/i,
      ];
      const allowedCommands = ["ls", "cat", "head", "tail", "find", "grep", "which", "file", "wc", "du"];
      const firstWord = command.trim().split(/\s+/)[0];

      const isAllowed = allowedCommands.includes(firstWord) || allowedForSession.has("bash:" + firstWord);
      const isDangerous = dangerousPatterns.some((p) => p.test(command));

      if (isAllowed && !isDangerous) return undefined;

      if (isSubagent) return undefined;

      if (!ctx.hasUI) return { block: true, reason: "Command blocked (no UI for confirmation)" };

      const choice = await ctx.ui.select(
         "Confirm bash command:",
         ["Yes", "Yes, for this session", "No"],
      );
      if (choice === "Yes, for this session") allowedForSession.add("bash:" + firstWord);
      if (choice !== "Yes" && choice !== "Yes, for this session") return { block: true, reason: "Blocked by user" };
    }

    if (event.toolName === "edit") {
      if (isSubagent) return undefined;
      if (!ctx.hasUI) return { block: true, reason: "Edit blocked (no UI for confirmation)" };

      const path = event.input.path as string;
      const choice = await ctx.ui.select(`Confirm edit:\n\n  ${path}\n\nAllow?`, ["Yes", "No"]);
      if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
    }

    if (event.toolName === "write") {
      if (isSubagent) return undefined;
      if (!ctx.hasUI) return { block: true, reason: "Write blocked (no UI for confirmation)" };

      const path = event.input.path as string;
      const choice = await ctx.ui.select(`Confirm write:\n\n  ${path}\n\nAllow?`, ["Yes", "No"]);
      if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
    }

    return undefined;
	});
}
