/**
 * MiMo provider for pi.
 *
 * Connects pi to Xiaomi's MiMo free AI API
 * (https://api.xiaomimimo.com/api/free-ai/openai/chat).
 *
 * Differences from the standard OpenAI Chat Completions API that this
 * provider handles:
 *  - Custom endpoint, not /v1/chat/completions
 *  - Bearer JWT obtained from /api/free-ai/bootstrap (no user API key)
 *  - Required headers: User-Agent, X-Mimo-Source, x-session-affinity
 *  - SSE chunks include `reasoning_content` for thinking text
 *  - Server validates the system prompt; it must be the official
 *    MiMoCode prompt. We use a custom `api` and a wrapper `streamSimple`
 *    that injects the system prompt from `mimo-system-prompt.txt` as
 *    the first system message and any other instruction prompt as a
 *    second system message.
 *
 * Authentication: JWT obtained lazily on the first request via
 * /api/free-ai/bootstrap, cached in memory, and reused for all subsequent
 * requests. No startup delay, no user API key required.
 *
 * The official MiMoCode system prompt lives in `mimo-system-prompt.txt`
 * (data, not code) so it's easy to update without touching the extension.
 */

import { createHash, randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const API_BASE = "https://api.xiaomimimo.com"
const BOOTSTRAP_URL = `${API_BASE}/api/free-ai/bootstrap`
const CHAT_URL = `${API_BASE}/api/free-ai/openai/chat`

function loadMimoSystemPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, "mimo-system-prompt.txt"),
    join(here, "..", "mimo-system-prompt.txt"),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf-8")
  }
  throw new Error(
    `pi-mimo-provider: mimo-system-prompt.txt not found. Looked in: ${candidates.join(", ")}`,
  )
}
const MIMO_SYSTEM_PROMPT = loadMimoSystemPrompt()

function generateClientFingerprint(): string {
  return createHash("sha256").update(randomUUID()).digest("hex")
}

function generateSessionId(): string {
  return `ses_${randomUUID().replace(/-/g, "").slice(0, 26)}`
}

// JWT cache — fetched lazily on first request, reused across the process lifetime.
let cachedJwt: string | null = null

async function bootstrap(): Promise<string> {
  if (cachedJwt) return cachedJwt

  const res = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: generateClientFingerprint() }),
  })
  if (!res.ok) throw new Error(`MiMo bootstrap failed: ${res.status}`)
  const data = (await res.json()) as { jwt: string }
  if (!data.jwt) throw new Error("MiMo bootstrap response missing jwt")

  cachedJwt = data.jwt
  return cachedJwt
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text ?? "")
    .join("\n")
}

function buildMessages(context: Context): any[] {
  const messages: any[] = []

  // First system message: the official MiMoCode prompt. The MiMo server
  // fingerprints this and rejects any variation (403 "Illegal access").
  messages.push({ role: "system", content: MIMO_SYSTEM_PROMPT })

  // Second system message (if pi composed a system prompt): pi's prompt.
  // Preserves the prompt that before_agent_start, --append-system-prompt,
  // and AGENTS.md discovery produce.
  const piSystem = context.systemPrompt ?? ""
  if (piSystem.trim()) {
    messages.push({ role: "system", content: piSystem })
  }

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const text = textFromContent(msg.content)
      if (text.trim()) messages.push({ role: "user", content: text })
    } else if (msg.role === "assistant") {
      const text = textFromContent(msg.content)
      const thinking = textFromContent(
        Array.isArray(msg.content)
          ? msg.content.filter((b: any) => b?.type === "thinking")
          : [],
      )
      const toolCalls = Array.isArray(msg.content)
        ? msg.content.filter((b: any) => b?.type === "toolCall")
        : []

      const assistantMsg: any = { role: "assistant", content: text || null }
      if (thinking) assistantMsg.reasoning = thinking
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        }))
      }
      if (text.trim() || assistantMsg.tool_calls) messages.push(assistantMsg)
    } else if (msg.role === "toolResult") {
      const text = textFromContent(msg.content)
      messages.push({
        role: "tool",
        content: text || "(empty)",
        tool_call_id: msg.toolCallId,
      })
    }
  }
  return messages
}

function streamMimo(
  model: Model<"mimo-custom">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()

  ;(async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    }

    let textBlock: { type: "text"; text: string } | undefined
    let thinkingBlock: { type: "thinking"; thinking: string } | undefined
    const toolCallBlocks = new Map<number, any>()

    try {
      const jwt = await bootstrap()
      const sessionId = generateSessionId()
      const messages = buildMessages(context)
      if (messages.length === 0) throw new Error("No messages to send to MiMo")

      const body: any = {
        model: model.id,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: options?.maxTokens ?? model.maxTokens,
        temperature: 1,
      }
      if (context.tools && context.tools.length > 0) {
        body.tools = context.tools.map((tool: any) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          },
        }))
        body.tool_choice = "auto"
      }

      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "User-Agent": "mimocode/0.1.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
          "X-Mimo-Source": "mimocode-cli-free",
          "x-session-affinity": sessionId,
          ...options?.headers,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => "")
        throw new Error(`MiMo API error ${response.status}: ${errBody.slice(0, 500)}`)
      }

      stream.push({ type: "start", partial: output })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data: ")) continue
          const data = trimmed.slice(6)
          if (data === "[DONE]") continue

          let chunk: any
          try {
            chunk = JSON.parse(data)
          } catch {
            continue
          }

          if (chunk.usage) {
            const u = chunk.usage
            const details = u.prompt_tokens_details ?? {}
            const cacheRead = details.cached_tokens ?? 0
            const cacheWrite = details.cache_write_tokens ?? 0
            const input = Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite)
            const outputTokens = u.completion_tokens ?? 0
            output.usage = {
              input,
              output: outputTokens,
              cacheRead,
              cacheWrite,
              totalTokens: input + outputTokens + cacheRead + cacheWrite,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            }
            calculateCost(model, output.usage)
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue

          if (choice.finish_reason) {
            switch (choice.finish_reason) {
              case "stop":
              case "end":
                output.stopReason = "stop"
                break
              case "length":
                output.stopReason = "length"
                break
              case "tool_calls":
                output.stopReason = "toolUse"
                break
              default:
                output.stopReason = "error"
                output.errorMessage = `finish_reason: ${choice.finish_reason}`
            }
          }

          const delta = choice.delta
          if (!delta) continue

          if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" }
              output.content.push(thinkingBlock)
              stream.push({
                type: "thinking_start",
                contentIndex: output.content.length - 1,
                partial: output,
              })
            }
            thinkingBlock.thinking += delta.reasoning_content
            stream.push({
              type: "thinking_delta",
              contentIndex: output.content.length - 1,
              delta: delta.reasoning_content,
              partial: output,
            })
          }

          if (typeof delta.content === "string" && delta.content.length > 0) {
            if (!textBlock) {
              textBlock = { type: "text", text: "" }
              output.content.push(textBlock)
              stream.push({
                type: "text_start",
                contentIndex: output.content.length - 1,
                partial: output,
              })
            }
            textBlock.text += delta.content
            stream.push({
              type: "text_delta",
              contentIndex: output.content.length - 1,
              delta: delta.content,
              partial: output,
            })
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              let block = toolCallBlocks.get(idx)
              if (!block) {
                block = {
                  type: "toolCall",
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  arguments: {},
                  partialArgs: "",
                  streamIndex: idx,
                }
                toolCallBlocks.set(idx, block)
                output.content.push(block)
                stream.push({
                  type: "toolcall_start",
                  contentIndex: output.content.length - 1,
                  partial: output,
                })
              }
              if (tc.id && !block.id) block.id = tc.id
              if (tc.function?.name && !block.name) block.name = tc.function.name
              if (tc.function?.arguments) {
                block.partialArgs += tc.function.arguments
                try {
                  block.arguments = JSON.parse(block.partialArgs)
                } catch {}
              }
              stream.push({
                type: "toolcall_delta",
                contentIndex: output.content.length - 1,
                delta: tc.function?.arguments ?? "",
                partial: output,
              })
            }
          }
        }
      }

      if (thinkingBlock) {
        const idx = output.content.indexOf(thinkingBlock)
        stream.push({ type: "thinking_end", contentIndex: idx, content: thinkingBlock.thinking, partial: output })
      }
      if (textBlock) {
        const idx = output.content.indexOf(textBlock)
        stream.push({ type: "text_end", contentIndex: idx, content: textBlock.text, partial: output })
      }

      for (let i = 0; i < output.content.length; i++) {
        const block = output.content[i] as any
        if (block.type === "toolCall") {
          try {
            block.arguments = JSON.parse(block.partialArgs)
          } catch {}
          delete block.partialArgs
          delete block.streamIndex
          stream.push({ type: "toolcall_end", contentIndex: i, toolCall: block, partial: output })
        }
      }

      if (options?.signal?.aborted) throw new Error("Request was aborted")
      if (output.stopReason === "error") throw new Error(output.errorMessage || "Provider error")

      stream.push({ type: "done", reason: output.stopReason as any, message: output })
      stream.end()
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error"
      output.errorMessage = error instanceof Error ? error.message : String(error)
      stream.push({ type: "error", reason: output.stopReason as any, error: output })
      stream.end()
    }
  })()

  return stream
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider("mimo", {
    name: "MiMo",
    baseUrl: CHAT_URL,
    apiKey: "placeholder",
    api: "mimo-custom",
    streamSimple: streamMimo,
    headers: {
      "User-Agent": "mimocode/0.1.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
      "X-Mimo-Source": "mimocode-cli-free",
    },
    models: [
      {
        id: "mimo-auto",
        name: "MiMo Auto",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 128_000,
      },
    ],
  })
}
