import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonWhitespaceText(text: string): boolean {
  return text.trim().length > 0;
}

function getPromptHistoryText(content: unknown): string {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      continue;
    }
    parts.push(block.text);
  }
  return parts.join("\n").replace(/\s+/g, " ").trim();
}

export function getProjectSessionsPath(sessionsPath: string, cwd: string): string {
  const projectKey = cwd
    .replace(/^[\\/]+|[\\/]+$/g, "")
    .replace(/[\\/]+/g, "-");
  return join(sessionsPath, `--${projectKey}--`);
}

export async function readRecentProjectPrompts(sessionsPath: string, cwd: string, limit: number): Promise<string[]> {
  const projectSessionsPath = getProjectSessionsPath(sessionsPath, cwd);
  if (!existsSync(projectSessionsPath)) {
    return [];
  }

  const promptEntries: { text: string; timestamp: number }[] = [];
  const fileNames = (await readdir(projectSessionsPath))
    .filter((fileName) => fileName.endsWith(".jsonl"));

  for (const fileName of fileNames) {
    const filePath = join(projectSessionsPath, fileName);
    const lines = (await readFile(filePath, "utf-8")).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"type":"message"') || !line.includes('"role":"user"')) {
        continue;
      }
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
        continue;
      }
      const text = getPromptHistoryText(entry.message.content);
      if (!hasNonWhitespaceText(text)) {
        continue;
      }
      const timestamp = typeof entry.message.timestamp === "number"
        ? entry.message.timestamp
        : typeof entry.timestamp === "string"
          ? Date.parse(entry.timestamp)
          : 0;
      promptEntries.push({ text, timestamp: Number.isFinite(timestamp) ? timestamp : 0 });
    }
  }

  promptEntries.sort((a, b) => b.timestamp - a.timestamp);
  const prompts: string[] = [];
  const seen = new Set<string>();
  for (const entry of promptEntries) {
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    prompts.push(entry.text);
    if (prompts.length >= limit) return prompts;
  }
  return prompts;
}
