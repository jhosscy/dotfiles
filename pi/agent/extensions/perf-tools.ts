import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ReadToolDetails, ReadToolInput, TruncationResult } from "@earendil-works/pi-coding-agent";
// Runtime imports use the installed global package path because globally discovered
// extensions are outside pi's package tree and cannot reliably resolve pi's runtime deps by package name.
// @ts-ignore - absolute runtime import for this local pi installation.
import { createReadTool } from "@earendil-works/pi-coding-agent";

const DEFAULT_MAX_LINES = Number.MAX_SAFE_INTEGER;
const DEFAULT_MAX_BYTES = Number.MAX_SAFE_INTEGER;

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const readSchema = {
	type: "object",
	properties: {
		path: { type: "string", description: "Path to the file to read (relative or absolute)" },
		offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
		limit: { type: "number", description: "Maximum number of lines to read" },
	},
	required: ["path"],
	additionalProperties: false,
} as const;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function normalizeToolPath(rawPath: string): string {
	const withoutMention = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
	if (withoutMention === "~") return os.homedir();
	if (withoutMention.startsWith("~/")) return path.join(os.homedir(), withoutMention.slice(2));
	return withoutMention;
}

function resolvePath(cwd: string, rawPath: string): string {
	const normalized = normalizeToolPath(rawPath);
	return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}

function isLikelyImage(filePath: string): boolean {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function emptyTruncation(totalLines: number, totalBytes: number, firstLineExceedsLimit = false): TruncationResult {
	return {
		content: "",
		truncated: true,
		truncatedBy: "bytes",
		totalLines,
		totalBytes,
		outputLines: 0,
		outputBytes: 0,
		lastLinePartial: false,
		firstLineExceedsLimit,
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	};
}

function buildTruncation(
	content: string,
	truncatedBy: "lines" | "bytes",
	totalLines: number,
	totalBytes: number,
	outputLines: number,
	outputBytes: number,
): TruncationResult {
	return {
		content,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines,
		outputBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	};
}

async function readTextStreaming(
	absolutePath: string,
	displayPath: string,
	offset: number | undefined,
	limit: number | undefined,
	signal?: AbortSignal,
): Promise<{ content: TextContent[]; details: ReadToolDetails | undefined }> {
	await fs.promises.access(absolutePath, fs.constants.R_OK);

	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	const selectedLimit = limit !== undefined ? Math.max(0, limit) : undefined;

	if (selectedLimit === 0) {
		return { content: [{ type: "text", text: "" }], details: undefined };
	}

	const stream = fs.createReadStream(absolutePath, { encoding: "utf8" });
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	const abort = () => stream.destroy(new Error("Operation aborted"));
	if (signal?.aborted) abort();
	signal?.addEventListener("abort", abort, { once: true });

	let totalFileLines = 0;
	let selectedTotalLines = 0;
	let selectedTotalBytes = 0;
	let outputBytes = 0;
	let firstSelectedLineBytes = 0;
	let truncatedBy: "lines" | "bytes" | undefined;
	const outputLines: string[] = [];

	try {
		for await (const line of rl) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const currentLineIndex = totalFileLines;
			totalFileLines += 1;

			if (currentLineIndex < startLine) continue;
			if (selectedLimit !== undefined && selectedTotalLines >= selectedLimit) continue;

			const lineBytesWithoutSeparator = Buffer.byteLength(line, "utf8");
			const separatorBytes = selectedTotalLines > 0 ? 1 : 0;
			const lineBytes = lineBytesWithoutSeparator + separatorBytes;
			selectedTotalLines += 1;
			selectedTotalBytes += lineBytes;
			if (selectedTotalLines === 1) firstSelectedLineBytes = lineBytesWithoutSeparator;

			if (truncatedBy) continue;
			if (outputLines.length >= DEFAULT_MAX_LINES) {
				truncatedBy = "lines";
				continue;
			}
			if (outputBytes + lineBytes > DEFAULT_MAX_BYTES) {
				truncatedBy = "bytes";
				continue;
			}

			outputLines.push(line);
			outputBytes += lineBytes;
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		rl.close();
	}

	if (startLine >= totalFileLines && totalFileLines > 0) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
	}

	if (selectedTotalLines === 0 && totalFileLines === 0 && startLine === 0) {
		return { content: [{ type: "text", text: "" }], details: undefined };
	}

	const outputContent = outputLines.join("\n");
	let outputText = outputContent;
	let details: ReadToolDetails | undefined;

	if (truncatedBy) {
		const endLineDisplay = startLineDisplay + Math.max(0, outputLines.length - 1);
		const nextOffset = endLineDisplay + 1;

		if (outputLines.length === 0 && firstSelectedLineBytes > DEFAULT_MAX_BYTES) {
			details = { truncation: emptyTruncation(selectedTotalLines, selectedTotalBytes, true) };
			outputText = `[Line ${startLineDisplay} is ${formatSize(firstSelectedLineBytes)}, exceeds ${formatSize(
				DEFAULT_MAX_BYTES,
			)} limit. Use bash: sed -n '${startLineDisplay}p' ${displayPath} | head -c ${DEFAULT_MAX_BYTES}]`;
		} else {
			details = {
				truncation: buildTruncation(
					outputContent,
					truncatedBy,
					selectedTotalLines,
					selectedTotalBytes,
					outputLines.length,
					outputBytes,
				),
			};
			if (truncatedBy === "lines") {
				outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
			} else {
				outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(
					DEFAULT_MAX_BYTES,
				)} limit). Use offset=${nextOffset} to continue.]`;
			}
		}
	} else if (selectedLimit !== undefined && startLine + selectedTotalLines < totalFileLines) {
		const remaining = totalFileLines - (startLine + selectedTotalLines);
		const nextOffset = startLine + selectedTotalLines + 1;
		outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
	}

	return { content: [{ type: "text", text: outputText }], details };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "read",
		label: "read (streaming)",
		description: "Read file contents using streaming text reads for lower memory use. Supports images via pi's built-in image reader. Use offset/limit for large files.",
		promptSnippet: "Read file contents with streaming low-memory text reads",
		promptGuidelines: ["Use read to examine files instead of cat or sed. The read tool streams text files and supports offset/limit for large files."],
		parameters: readSchema,
		prepareArguments(args) {
			if (!args || typeof args !== "object") return args;
			const input = args as { path?: unknown; file_path?: unknown };
			if (typeof input.path !== "string" && typeof input.file_path === "string") {
				return { ...input, path: input.file_path };
			}
			return args;
		},
		async execute(toolCallId, params: ReadToolInput, signal, onUpdate, ctx) {
			const absolutePath = resolvePath(ctx.cwd, params.path);

			if (isLikelyImage(absolutePath)) {
				return createReadTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			}

			return readTextStreaming(absolutePath, params.path, params.offset, params.limit, signal);
		},
	});
}
