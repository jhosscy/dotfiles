/**
 * tokenRouter MiniMax-M3 streaming fix (in-band reasoning)
 *
 * Problem: MiniMax-M3 via tokenRouter now sends thinking text inside
 *   - delta.content, wrapped in <think>...</mm:think> tags
 *
 * The default streamSimpleOpenAICompletions does not recognize those tags, so
 * the thinking text leaks into the visible text block and no thinking block
 * is produced.
 *
 * Solution: Custom streamSimple with a streaming tag parser that:
 *   - Splits delta.content at <think> and </mm:think> boundaries
 *   - Routes text between tags → thinking block
 *   - Routes text after </mm:think> → text block
 *   - Buffers any trailing characters that could be the start of a tag
 *     split across chunks (e.g. one chunk ends with "<th" and the next
 *     starts with "ink>")
 */

import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	calculateCost,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function streamTokenRouter(
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
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
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

			// Build messages and tools for the API request
			const messages: any[] = [];
			if (context.systemPrompt) {
				messages.push({ role: "system", content: context.systemPrompt });
			}
			for (const msg of context.messages) {
				if (msg.role === "user") {
					// Match the upstream playground format: user content is an array
					// of content blocks ({type:"text", text:"..."} or {type:"image_url", ...}).
					if (typeof msg.content === "string") {
						if (msg.content.trim()) {
							messages.push({
								role: "user",
								content: [{ type: "text", text: msg.content }],
							});
						}
					} else {
						const blocks: any[] = msg.content
							.map((b: any) => {
								if (b.type === "text") return { type: "text", text: b.text };
								if (b.type === "image") {
									return {
										type: "image_url",
										image_url: { url: `data:${b.mimeType};base64,${b.data}` },
									};
								}
								return null;
							})
							.filter(Boolean);
						if (blocks.length > 0) messages.push({ role: "user", content: blocks });
					}
				} else if (msg.role === "assistant") {
					const textParts = msg.content
						.filter((b: any) => b.type === "text" && b.text.trim())
						.map((b: any) => b.text);
					const thinkingParts = msg.content
						.filter((b: any) => b.type === "thinking" && b.thinking.trim())
						.map((b: any) => b.thinking);

					// The upstream expects the assistant content as a single string with
					// the thinking embedded inline as <think>...</think> tags — same shape
					// our stream parser already extracts from delta.content. This keeps the
					// request roundtrip symmetric with the response format and matches the
					// vendor playground's payload exactly.
					const thinkingBlock = thinkingParts.length > 0
						? thinkingParts.map((t: string) => `<think>\n${t}\n</think>`).join("\n")
						: "";
					const visibleText = textParts.join("");
					const inlineContent =
						thinkingBlock +
						(thinkingBlock && visibleText ? "\n" : "") +
						visibleText;

					const assistantMsg: any = { role: "assistant", content: inlineContent || null };

					const toolCalls = msg.content.filter((b: any) => b.type === "toolCall");
					if (toolCalls.length > 0) {
						assistantMsg.tool_calls = toolCalls.map((tc: any) => ({
							id: tc.id,
							type: "function",
							function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
						}));
					}
					if (inlineContent || assistantMsg.tool_calls) {
						messages.push(assistantMsg);
					}
				} else if (msg.role === "toolResult") {
					const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
					messages.push({
						role: "tool",
						content: text || "(empty)",
						tool_call_id: msg.toolCallId,
					});
				}
			}

			const params: any = {
				model: model.id,
				messages,
				stream: true,
				max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
				stream_options: { include_usage: true },
			};

			if (context.tools && context.tools.length > 0) {
				params.tools = context.tools.map((tool) => ({
					type: "function",
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
						strict: false,
					},
				}));
			}

			// Enable thinking via chat_template_kwargs (qwen-chat-template format)
			if (model.reasoning && options?.reasoning) {
				params.chat_template_kwargs = {
					enable_thinking: true,
					preserve_thinking: true,
				};
			}

			const url = `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					...model.headers,
					...options?.headers,
				},
				body: JSON.stringify(params),
				signal: options?.signal,
			});

			if (!response.ok) {
				const body = await response.text();
				throw new Error(`API error ${response.status}: ${body}`);
			}

			stream.push({ type: "start", partial: output });

			let thinkingBlock: any = null;
			let textBlock: any = null;

			const ensureThinkingBlock = () => {
				if (!thinkingBlock) {
					thinkingBlock = { type: "thinking", thinking: "" };
					output.content.push(thinkingBlock);
					stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
				}
				return thinkingBlock;
			};

			const ensureTextBlock = () => {
				if (!textBlock) {
					textBlock = { type: "text", text: "" };
					output.content.push(textBlock);
					stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
				}
				return textBlock;
			};

			// In-band reasoning parser: tokenRouter wraps thinking inside
			// delta.content with <think>...</mm:think> tags (no separate reasoning
			// field). We use a streaming state machine that splits the content
			// at those tag boundaries and routes the chunks to the right block.
			// Tags can be split across chunks, so we buffer partial prefixes.
			const TAG_OPEN = "<think>";
			const TAG_CLOSE = "</think>";
			let reasoningState: "before" | "thinking" | "after" = "before";
			let pendingText = "";

			const emitForState = (text: string) => {
				if (!text) return;
				if (reasoningState === "thinking") {
					const block = ensureThinkingBlock();
					block.thinking += text;
					stream.push({ type: "thinking_delta", contentIndex: output.content.length - 1, delta: text, partial: output });
				} else {
					const block = ensureTextBlock();
					block.text += text;
					stream.push({ type: "text_delta", contentIndex: output.content.length - 1, delta: text, partial: output });
				}
			};

			// Longest proper prefix of TAG_OPEN or TAG_CLOSE that is also a suffix
			// of `s`. This is the number of trailing characters to hold back because
			// they might be the start of a tag completed in a future chunk.
			const tagHoldback = (s: string): number => {
				let best = 0;
				for (const tag of [TAG_OPEN, TAG_CLOSE]) {
					const maxLen = Math.min(s.length, tag.length - 1);
					for (let len = maxLen; len > 0; len--) {
						if (s.endsWith(tag.slice(0, len))) {
							if (len > best) best = len;
							break;
						}
					}
				}
				return best;
			};

			const feedContent = (text: string) => {
				pendingText += text;
				while (true) {
					const openIdx = pendingText.indexOf(TAG_OPEN);
					const closeIdx = pendingText.indexOf(TAG_CLOSE);
					let tagIdx = -1;
					let tagLen = 0;
					let isOpen = false;
					if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
						tagIdx = openIdx;
						tagLen = TAG_OPEN.length;
						isOpen = true;
					} else if (closeIdx !== -1) {
						tagIdx = closeIdx;
						tagLen = TAG_CLOSE.length;
						isOpen = false;
					}
					if (tagIdx === -1) {
						// No complete tag in buffer — hold back the longest suffix
						// that is a proper prefix of either tag, emit the rest.
						const hold = tagHoldback(pendingText);
						if (hold > 0) {
							emitForState(pendingText.slice(0, pendingText.length - hold));
							pendingText = pendingText.slice(pendingText.length - hold);
						} else {
							emitForState(pendingText);
							pendingText = "";
						}
						return;
					}
					// Emit text before the tag, transition state, consume the tag.
					emitForState(pendingText.slice(0, tagIdx));
					if (isOpen) {
						if (reasoningState === "before") reasoningState = "thinking";
					} else {
						if (reasoningState === "thinking") reasoningState = "after";
					}
					pendingText = pendingText.slice(tagIdx + tagLen);
				}
			};

			const flushPending = () => {
				if (pendingText) {
					emitForState(pendingText);
					pendingText = "";
				}
			};

			// Parse SSE stream
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop()!;

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith("data: ")) continue;
					const data = trimmed.slice(6);
					if (data === "[DONE]") continue;

					let chunk: any;
					try {
						chunk = JSON.parse(data);
					} catch {
						continue;
					}

					// Usage (final chunk)
					if (chunk.usage) {
						const u = chunk.usage;
						const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
						const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
						const input = Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite);
						const outputTokens = u.completion_tokens ?? 0;
						output.usage = {
							input,
							output: outputTokens,
							cacheRead,
							cacheWrite,
							totalTokens: input + outputTokens + cacheRead + cacheWrite,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
						calculateCost(model, output.usage);
					}

					if (typeof chunk.model === "string" && chunk.model.length > 0 && chunk.model !== model.id) {
						output.responseModel ||= chunk.model;
					}
					output.responseId ||= chunk.id;

					const choice = chunk.choices?.[0];
					if (!choice) continue;

					if (choice.finish_reason) {
						switch (choice.finish_reason) {
							case "stop":
							case "end":
								output.stopReason = "stop";
								break;
							case "length":
								output.stopReason = "length";
								break;
							case "tool_calls":
								output.stopReason = "toolUse";
								break;
							default:
								output.stopReason = "error";
								output.errorMessage = `finish_reason: ${choice.finish_reason}`;
						}
					}

					const delta = choice.delta;
					if (!delta) continue;

					// Route delta.content through the in-band reasoning state machine,
					// which parses <think>...</mm:think> tags and splits the text
					// between a thinking block and a text block.
					if (typeof delta.content === "string" && delta.content.length > 0) {
						feedContent(delta.content);
					}

					// Process tool calls
					if (delta.tool_calls) {
						for (const tc of delta.tool_calls) {
							const idx = tc.index ?? 0;
							let block = output.content.find(
								(b: any) => b.type === "toolCall" && b.streamIndex === idx,
							) as any;
							if (!block) {
								block = {
									type: "toolCall",
									id: tc.id || "",
									name: tc.function?.name || "",
									arguments: {},
									partialArgs: "",
									streamIndex: idx,
								};
								output.content.push(block);
								stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
							}
							if (tc.id && !block.id) block.id = tc.id;
							if (tc.function?.name && !block.name) block.name = tc.function.name;
							if (tc.function?.arguments) {
								block.partialArgs += tc.function.arguments;
								try { block.arguments = JSON.parse(block.partialArgs); } catch {}
							}
							stream.push({
								type: "toolcall_delta",
								contentIndex: output.content.length - 1,
								delta: tc.function?.arguments ?? "",
								partial: output,
							});
						}
					}
				}
			}

			// Flush any text the parser was still holding for a partial tag.
			flushPending();

			// Finalize all blocks
			for (let i = 0; i < output.content.length; i++) {
				const block = output.content[i] as any;
				if (block.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: i, content: block.thinking, partial: output });
				} else if (block.type === "text") {
					stream.push({ type: "text_end", contentIndex: i, content: block.text, partial: output });
				} else if (block.type === "toolCall") {
					try { block.arguments = JSON.parse(block.partialArgs); } catch {}
					delete block.partialArgs;
					delete block.streamIndex;
					stream.push({ type: "toolcall_end", contentIndex: i, toolCall: block, partial: output });
				}
			}

			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "error") throw new Error(output.errorMessage || "Provider error");
			if (output.stopReason === "aborted") throw new Error("Request was aborted");

			stream.push({ type: "done", reason: output.stopReason as any, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				delete (block as any).partialArgs;
				delete (block as any).streamIndex;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason as any, error: output });
			stream.end();
		}
	})();

	return stream;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("tokenRouter", {
		baseUrl: "https://api.tokenrouter.com/v1",
		apiKey: "$TOKENROUTER_API_KEY",
		api: "tokenrouter-custom",
		models: [
			{
				id: "MiniMax-M3",
				name: "MiniMax M3",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 1048576,
				maxTokens: 128000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					supportsDeveloperRole: false,
					supportsStore: false,
					maxTokensField: "max_tokens",
					supportsReasoningEffort: false,
					thinkingFormat: "deepseek",
				},
				thinkingLevelMap: {
					minimal: null,
					low: null,
					medium: null,
					high: "high",
				},
			},
		],
		streamSimple: streamTokenRouter,
	});
}
