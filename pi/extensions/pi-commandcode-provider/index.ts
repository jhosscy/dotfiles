/**
 * Command Code provider for pi.
 *
 * Connects pi to Command Code's API (https://api.commandcode.ai/alpha/generate).
 *
 * Authentication (pick one):
 *   1. Run `/login`, then select Command Code — opens browser to commandcode.ai, auto-stores API key
 *   2. Set COMMANDCODE_API_KEY environment variable
 *   3. Place API key in `~/.commandcode/auth.json` or `~/.pi/agent/auth.json`
 *      as {"apiKey": "user_..."} or {"commandcode": "user_..."}
 *
 * Models: deepseek-v4-pro, deepseek-v4-flash, claude-sonnet-4-6, claude-opus-4-7, etc.
 */

import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { createStreamCommandCode, DEFAULT_API_BASE } from "./src/core.ts"
import { getApiKey, login, refreshToken } from "./src/oauth.ts"

const API_BASE = process.env.COMMANDCODE_API_BASE ?? DEFAULT_API_BASE

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

const MODELS = [
  // Premium (Anthropic)
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
  // Premium (OpenAI)
  {
    id: "gpt-5.5",
    name: "GPT-5.5 (CC)",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 128_000,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4 (CC)",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 128_000,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (CC)",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 128_000,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (CC)",
    reasoning: false,
    contextWindow: 256_000,
    maxTokens: 128_000,
  },
  // Open-source
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro (CC)",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    // Promo 4× hasta May 31 2026 (normal: $1.74/$3.48)
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
  },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (CC)",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.01, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K2.6",
    name: "Kimi K2.6 (CC)",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 131_072,
  },
  {
    id: "moonshotai/Kimi-K2.5",
    name: "Kimi K2.5 (CC)",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 131_072,
  },
  {
    id: "zai-org/GLM-5.1",
    name: "GLM-5.1 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 131_072,
  },
  {
    id: "zai-org/GLM-5",
    name: "GLM-5 (CC)",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 131_072,
  },
  {
    id: "MiniMaxAI/MiniMax-M2.7",
    name: "MiniMax M2.7 (CC)",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
  {
    id: "MiniMaxAI/MiniMax-M2.5",
    name: "MiniMax M2.5 (CC)",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
  {
    id: "Qwen/Qwen3.6-Max-Preview",
    name: "Qwen 3.6 Max (CC)",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
  },
  {
    id: "Qwen/Qwen3.6-Plus",
    name: "Qwen 3.6 Plus (CC)",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
  },
  {
    id: "Qwen/Qwen3.7-Max",
    name: "Qwen 3.7 Max (CC)",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    // Promo 2× (normal: $2.50/$7.50)
    cost: { input: 1.25, output: 3.75, cacheRead: 0.25, cacheWrite: 1.56 },
  },
]

const streamCommandCode = createStreamCommandCode({
  createStream: createAssistantMessageEventStream,
  calculateCost,
  apiBase: API_BASE,
})

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerProvider("commandcode", {
    name: "Command Code",
    baseUrl: API_BASE,
    apiKey: "COMMANDCODE_API_KEY",
    authHeader: true,
    api: "commandcode-custom",
    streamSimple: streamCommandCode,
    headers: {
      "x-command-code-version": "0.24.1",
      "x-cli-environment": "production",
    },
    oauth: {
      name: "Command Code",
      login,
      refreshToken,
      getApiKey,
    },
    models: MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: ["text"],
      // Hardcoded costs are a fallback for when the API doesn't report
      // providerMetadata.gateway cost (primary source). DeepSeek and Qwen 3.7
      // have prices from the official docs; all others default to 0.
      cost: "cost" in model
        ? (model as any).cost
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  })

  // Handle generic context overflow errors
  pi.on("message_end", (event, ctx) => {
    const message = event.message
    if (message.role !== "assistant") return
    if (message.stopReason !== "error") return
    if (message.provider !== "commandcode" && ctx.model?.provider !== "commandcode") return

    const errorMessage = message.errorMessage ?? ""
    if (errorMessage.includes("context_length_exceeded")) return
    if (!/context_length_exceeded|maximum context length|too many tokens/i.test(errorMessage)) return

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    }
  })
}
