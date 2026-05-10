import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { UsageStats } from "./types.js";

export interface SessionMetrics {
  usageStats: UsageStats;
  contextTokens: number;
  responseModel?: string;
}

const EMPTY_METRICS: SessionMetrics = {
  usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  contextTokens: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SessionAssistantUsage = AssistantMessage["usage"];

function hasSessionAssistantUsage(value: unknown): value is SessionAssistantUsage {
  if (!isRecord(value)) return false;
  return typeof value.input === "number"
    && typeof value.output === "number"
    && typeof value.cacheRead === "number"
    && typeof value.cacheWrite === "number"
    && isRecord(value.cost)
    && typeof value.cost.total === "number";
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && hasSessionAssistantUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

export function collectSessionMetrics(ctx: any, modelChangedAt: number): SessionMetrics {
  const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let lastAssistant: AssistantMessage | undefined;

  for (const entry of sessionEvents) {
    if (!isRecord(entry) || entry.type !== "message" || !isSessionAssistantMessage(entry.message)) {
      continue;
    }
    const message = entry.message;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      continue;
    }
    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    cacheWrite += message.usage.cacheWrite;
    cost += message.usage.cost.total;
    lastAssistant = message;
  }

  const contextTokens = lastAssistant
    ? lastAssistant.usage.input + lastAssistant.usage.output + lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
    : 0;
  const assistantMatchesCurrentModel = !lastAssistant || modelChangedAt === 0 || lastAssistant.timestamp >= modelChangedAt;
  const responseModel = assistantMatchesCurrentModel
    ? lastAssistant?.responseModel ?? lastAssistant?.model
    : undefined;

  return {
    usageStats: { input, output, cacheRead, cacheWrite, cost },
    contextTokens,
    responseModel,
  };
}

export function emptySessionMetrics(): SessionMetrics {
  return {
    usageStats: { ...EMPTY_METRICS.usageStats },
    contextTokens: EMPTY_METRICS.contextTokens,
    responseModel: EMPTY_METRICS.responseModel,
  };
}
