import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	generateImages,
	registerImagesApiProvider,
	type AssistantImages,
	type ImagesContext,
	type ImagesModel,
	type ProviderImagesOptions,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getImageDimensions, Text, truncateToWidth } from "@earendil-works/pi-tui";

const MODEL_ID = "black-forest-labs/flux-2-klein-4b";

const model: ImagesModel<"replicate-images"> = {
	id: MODEL_ID,
	name: "Replicate FLUX.2 Klein 4B",
	api: "replicate-images",
	provider: "replicate",
	baseUrl: "https://api.replicate.com/v1",
	input: ["text"],
	output: ["image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function chafaSixel(imagePath: string, cols: number, rows: number): string[] | null {
	try {
		const sixel = execFileSync("chafa", [
			"--format=sixels",
			"--animate=off",
			"--polite=on",
			"--passthrough=none",
			`--size=${Math.max(1, cols)}x${Math.max(1, rows)}`,
			imagePath,
		], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		}).replace(/[\r\n]/g, "");

		if (!sixel) return null;

		const marker = "\x1b_Ga=d,d=I,i=0\x1b\\";
		const moveUp = rows > 1 ? `\x1b[${rows - 1}A` : "";
		const lines: string[] = [];
		for (let i = 0; i < rows - 1; i++) lines.push("");
		lines.push("\x1b7" + moveUp + marker + sixel + "\x1b8");
		return lines;
	} catch {
		return null;
	}
}

async function generateImagesReplicate(
	model: ImagesModel<"replicate-images">,
	context: ImagesContext,
	options?: ProviderImagesOptions,
): Promise<AssistantImages> {
	const result: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const apiKey = options?.apiKey || process.env.REPLICATE_API_TOKEN;
		if (!apiKey) throw new Error("Missing REPLICATE_API_TOKEN");

		const prompt = context.input
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n\n");

		const response = await fetch(`${model.baseUrl}/models/${model.id}/predictions`, {
			method: "POST",
			signal: options?.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				Prefer: "wait",
			},
			body: JSON.stringify({ input: { prompt } }),
		});

		if (!response.ok) {
			throw new Error(`Replicate error ${response.status}: ${await response.text()}`);
		}

		let prediction = await response.json() as any;
		while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
			if (!prediction.urls?.get) throw new Error("Replicate did not return a polling URL");
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const poll = await fetch(prediction.urls.get, {
				signal: options?.signal,
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			if (!poll.ok) throw new Error(`Replicate poll error ${poll.status}: ${await poll.text()}`);
			prediction = await poll.json();
		}

		result.responseId = prediction.id;
		if (prediction.status !== "succeeded") {
			throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error || "unknown error"}`);
		}

		const urls = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
		for (const url of urls.filter(Boolean)) {
			const imageResponse = await fetch(String(url), { signal: options?.signal });
			if (!imageResponse.ok) throw new Error(`Image download failed ${imageResponse.status}`);

			result.output.push({
				type: "image",
				mimeType: imageResponse.headers.get("content-type") || "image/jpeg",
				data: Buffer.from(await imageResponse.arrayBuffer()).toString("base64"),
			});
		}

		return result;
	} catch (error) {
		result.stopReason = options?.signal?.aborted ? "aborted" : "error";
		result.errorMessage = error instanceof Error ? error.message : String(error);
		return result;
	}
}

export default function (pi: ExtensionAPI) {
	registerImagesApiProvider({
		api: "replicate-images",
		generateImages: generateImagesReplicate,
	});

	pi.registerTool({
		name: "generate_image",
		label: "Generate Image",
		description: `Generate an image with Replicate model ${MODEL_ID}.`,
		promptSnippet: "Generate an image with Replicate FLUX.2 Klein 4B.",
		promptGuidelines: [
			"Use generate_image when the user asks to create, draw, render, or generate an image.",
		],
		parameters: Type.Object({
			prompt: Type.String({ description: "Detailed image prompt." }),
			outputPath: Type.Optional(Type.String({ description: "Optional path to save the generated image." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: "Generating image with Replicate..." }] });

			const generated = await generateImages(model, {
				input: [{ type: "text", text: params.prompt }],
			}, {
				apiKey: process.env.REPLICATE_API_TOKEN,
				signal,
			});

			if (generated.stopReason === "error") {
				return {
					isError: true,
					content: [{ type: "text", text: generated.errorMessage || "Image generation failed." }],
					details: generated,
				};
			}

			const image = generated.output.find((item) => item.type === "image");
			let savedPath: string | undefined;

			if (image) {
				savedPath = params.outputPath || join(process.cwd(), ".pi", "generated-images", `replicate-${Date.now()}.jpg`);
				mkdirSync(dirname(savedPath), { recursive: true });
				writeFileSync(savedPath, Buffer.from(image.data, "base64"));
			}

			return {
				content: [
					...(savedPath ? [{ type: "text" as const, text: `Saved image to: ${savedPath}` }] : []),
					...generated.output,
				],
				details: { model: MODEL_ID, savedPath, responseId: generated.responseId },
			};
		},

		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Generating image..."), 0, 0);

			const savedPath = typeof result.details?.savedPath === "string" ? result.details.savedPath : undefined;
			if (!savedPath) return new Text(theme.fg("error", "No generated image path"), 0, 0);

			if (!expanded) {
				return new Text(
					theme.fg("success", "Replicate image generated") + "\n" +
					theme.fg("muted", "CTRL-O to show image") + "\n" +
					theme.fg("dim", savedPath),
					0,
					0,
				);
			}

			return {
				render(width: number) {
					if (!existsSync(savedPath)) {
						return [theme.fg("error", truncateToWidth(`Image file not found: ${savedPath}`, width))];
					}

					const imageContent = result.content.find((item: any) => item?.type === "image") as any;
					const buffer = readFileSync(savedPath);
					const dims = getImageDimensions(buffer.toString("base64"), imageContent?.mimeType || "image/jpeg");
					const termCols = process.stdout.columns || 80;
					const termRows = process.stdout.rows || 40;
					const cols = Math.min(Math.max(10, termCols), Math.max(10, Math.floor(width * 0.65)));
					const rows = dims
						? Math.min(Math.max(10, termRows - 10), Math.max(4, Math.ceil((dims.heightPx / dims.widthPx) * cols * (9 / 18))))
						: Math.min(Math.max(10, termRows - 10), Math.ceil(cols * 0.5));

					const sixel = chafaSixel(savedPath, cols, rows);
					if (!sixel) {
						return [
							theme.fg("error", truncateToWidth("Could not render image with chafa", width)),
							theme.fg("dim", truncateToWidth(savedPath, width)),
						];
					}

					const pad = Math.max(0, Math.floor((termCols - cols) / 2));
					sixel[sixel.length - 1] = " ".repeat(pad) + sixel[sixel.length - 1];

					return [
						theme.fg("toolOutput", truncateToWidth(`Saved: ${savedPath}`, width)),
						"",
						...sixel,
					];
				},
				invalidate() {},
			};
		}, 
	});
}
