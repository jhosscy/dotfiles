import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  getImageDimensions,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";

function getText(result: any): string {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => String(c.text ?? ""))
    .filter(Boolean)
    .join("\n");
}

function extractReplicateImageUrl(text: string): string | undefined {
  try {
    return JSON.parse(text).output[0];
  } catch {
    return undefined;
  }
}

function getSessionId(result: any): string {
  const value = result?.details?.sessionId;
  return typeof value === "string" && value.length > 0
    ? value
    : "unknown-session";
}

function imagePathForUrl(url: string, sessionId: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return join(
    process.cwd(),
    ".generated-images",
    sessionId,
    `mcp-replicate-${hash}.png`,
  );
}

function downloadImage(url: string, path: string): Buffer {
  if (existsSync(path)) return readFileSync(path);

  const buffer = execFileSync("curl", ["-fsSL", "--max-time", "30", url], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }) as Buffer;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  return buffer;
}

function chafaSixel(
  imagePath: string,
  cols: number,
  rows: number,
): string[] | null {
  try {
    // Match show-image.ts behavior: pass a real file path to chafa instead of
    // stdin. Here we can use the already cached image path directly.
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

export function renderMcpImageResult(
  result: any,
  opts: { expanded: boolean },
  theme: any,
): any {
  const text = getText(result);
  const imageUrl = extractReplicateImageUrl(text);

  if (!imageUrl) {
    return new Text(theme.fg("toolOutput", text), 0, 0);
  }

  const sessionId = getSessionId(result);
  const imagePath = imagePathForUrl(imageUrl, sessionId);

  let buffer: Buffer;
  try {
    buffer = downloadImage(imageUrl, imagePath);
  } catch {
    return {
      render(width: number) {
        return [
          theme.fg(
            "error",
            truncateToWidth("Could not download Replicate image", width),
          ),
          theme.fg("dim", truncateToWidth(imageUrl, width)),
        ];
      },
      invalidate() {},
    };
  }

  if (!opts.expanded) {
    return new Text(
      theme.fg("success", "Replicate image saved") +
        "\n" +
        theme.fg("muted", "CTRL-O to show image"),
      0,
      0,
    );
  }

  return {
    render(width: number) {
      const fileBuffer = existsSync(imagePath)
        ? readFileSync(imagePath)
        : buffer;
      const dims = getImageDimensions(
        fileBuffer.toString("base64"),
        "image/png",
      );

      const termCols = process.stdout.columns || 80;
      const termRows = process.stdout.rows || 40;

      // Same sizing policy as show-image.ts, but with terminal width as the
      // hard ceiling instead of 80 cols.
      const maxCols = Math.max(10, termCols);
      const cols = dims
        ? Math.min(maxCols, Math.max(10, Math.floor(width * 0.65)))
        : Math.min(maxCols, Math.floor(width * 0.5));
      const maxRows = Math.max(10, termRows - 10);
      const rows = dims
        ? Math.min(
          maxRows,
          Math.max(4, Math.ceil((dims.heightPx / dims.widthPx) * cols * (9 / 18))),
        )
        : Math.min(maxRows, Math.ceil(cols * 0.5));

      const sixel = chafaSixel(imagePath, cols, rows);
      if (!sixel) {
        return [
          theme.fg(
            "error",
            truncateToWidth(
              "Could not render Replicate image with chafa",
              width,
            ),
          ),
        ];
      }

      const pad = Math.max(0, Math.floor((termCols - cols) / 2));
      const last = sixel.length - 1;
      sixel[last] = " ".repeat(pad) + sixel[last];

      return [
        theme.fg("toolOutput", truncateToWidth(`Image: ${imageUrl}`, width)),
        theme.fg("toolOutput", truncateToWidth(`Saved: ${imagePath}`, width)),
        "",
        ...sixel,
      ];
    },
    invalidate() {},
  };
}
