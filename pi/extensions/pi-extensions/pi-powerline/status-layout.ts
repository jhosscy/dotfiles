/**
 * Responsive powerline layout.
 *
 * Two real columns (left, right-aligned) plus a secondary row. Segments are
 * measured first and dropped by priority (last declared = lowest) before
 * anything is formatted, so a narrow terminal does not pay for formatting
 * segments it will not show. Nothing is dropped silently: what does not fit on
 * the top row overflows to the secondary row, and a segment that is still too
 * wide is truncated with an ellipsis.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { mergeSegmentsWithCustomItems, type PowerlineConfig } from "./powerline-config.js";
import { renderSegment } from "./segments.js";
import { getSeparator } from "./separators.js";
import { fg } from "./theme.js";
import type { PresetDef, SegmentContext, StatusLineSegmentId } from "./types.js";

/** Leading and trailing padding of every row. */
const ROW_OVERHEAD = 2;
/** Minimum blank space between the left and right columns. */
const MIN_COLUMN_GAP = 2;
/** Minimum room worth spending on a truncated overflow segment. */
const MIN_TRUNCATED_WIDTH = 8;

interface RenderedSegment {
  id: StatusLineSegmentId;
  content: string;
  width: number;
}

function renderSegments(ids: readonly StatusLineSegmentId[], ctx: SegmentContext): RenderedSegment[] {
  const rendered: RenderedSegment[] = [];
  for (const id of ids) {
    const result = renderSegment(id, ctx);
    if (!result.visible || !result.content) continue;
    rendered.push({ id, content: result.content, width: visibleWidth(result.content) });
  }
  return rendered;
}

function widthOf(segments: readonly RenderedSegment[], separatorWidth: number): number {
  if (segments.length === 0) return 0;
  let width = separatorWidth * (segments.length - 1);
  for (const segment of segments) width += segment.width;
  return width;
}

function joinSegments(
  segments: readonly RenderedSegment[],
  ctx: SegmentContext,
  separator: string,
): string {
  const styled = fg(ctx.theme, "separator", separator, ctx.colors);
  return segments.map((segment) => segment.content).join(styled);
}

/** Truncate one segment so a row always shows something. */
function truncateSegment(
  segment: RenderedSegment,
  ctx: SegmentContext,
  available: number,
): string | null {
  const room = available - ROW_OVERHEAD;
  if (room < MIN_TRUNCATED_WIDTH) return null;
  return truncateToWidth(segment.content, room, fg(ctx.theme, "separator", "…", ctx.colors));
}

export interface PowerlineLayout {
  top: string;
  secondary: string;
}

export interface LayoutOptions {
  /**
   * `right` (default) pads the right column to the row width, for a standalone
   * row. `left` keeps both columns in one flow so the caller can fill the rest
   * of the line itself - that is what the editor border needs, where the bar is
   * followed by `─` fill up to the terminal edge.
   */
  align?: "left" | "right";
}

export function computeLayout(
  ctx: SegmentContext,
  presetDef: PresetDef,
  customItems: PowerlineConfig["customItems"],
  availableWidth: number,
  options: LayoutOptions = {},
): PowerlineLayout {
  const width = Math.max(1, availableWidth);
  const align = options.align ?? "right";
  const separator = getSeparator(presetDef.separator).left;
  const separatorWidth = visibleWidth(separator);
  const merged = mergeSegmentsWithCustomItems(presetDef, customItems);

  const left = renderSegments(merged.leftSegments, ctx);
  const right = renderSegments(merged.rightSegments, ctx);
  const secondaryIds = merged.secondarySegments;

  // Drop by priority until the row fits: the right column goes first (its tail
  // is the least important), then the left column's tail.
  let keepLeft = left.length;
  let keepRight = right.length;
  const fits = (): boolean => {
    if (align === "left") {
      const flow = [...left.slice(0, keepLeft), ...right.slice(0, keepRight)];
      return widthOf(flow, separatorWidth) + ROW_OVERHEAD <= width;
    }
    return (
      widthOf(left.slice(0, keepLeft), separatorWidth) +
        widthOf(right.slice(0, keepRight), separatorWidth) +
        (keepLeft > 0 && keepRight > 0 ? MIN_COLUMN_GAP : 0) +
        ROW_OVERHEAD <=
      width
    );
  };
  while (!fits() && (keepLeft > 0 || keepRight > 0)) {
    if (keepRight > 0) {
      keepRight--;
    } else {
      keepLeft--;
    }
  }

  const topLeft = left.slice(0, keepLeft);
  const topRight = right.slice(0, keepRight);
  const overflow = [...left.slice(keepLeft), ...right.slice(keepRight)];

  let top = "";
  if (align === "left") {
    const flow = [...topLeft, ...topRight];
    if (flow.length > 0) top = ` ${joinSegments(flow, ctx, separator)} `;
  } else {
    const leftText = joinSegments(topLeft, ctx, separator);
    const rightText = joinSegments(topRight, ctx, separator);
    if (leftText && rightText) {
      const gap = Math.max(
        MIN_COLUMN_GAP,
        width - ROW_OVERHEAD - visibleWidth(leftText) - visibleWidth(rightText),
      );
      top = ` ${leftText}${" ".repeat(gap)}${rightText} `;
    } else if (leftText) {
      top = ` ${leftText} `;
    } else if (rightText) {
      const gap = Math.max(0, width - ROW_OVERHEAD - visibleWidth(rightText));
      top = ` ${" ".repeat(gap)}${rightText} `;
    }
  }
  if (top && visibleWidth(top) > width) {
    top = truncateToWidth(top, width, "");
  }

  // Secondary row: the preset's own secondary segments first, then whatever
  // overflowed the top row, in declaration order.
  const secondary = [...renderSegments(secondaryIds, ctx), ...overflow];
  let secondaryContent = "";
  if (secondary.length > 0) {
    let keep = secondary.length;
    const fitsSecondary = (): boolean =>
      widthOf(secondary.slice(0, keep), separatorWidth) + ROW_OVERHEAD <= width;
    while (!fitsSecondary() && keep > 0) {
      keep--;
    }
    const kept = secondary.slice(0, keep);
    let text = joinSegments(kept, ctx, separator);
    let used = widthOf(kept, separatorWidth) + ROW_OVERHEAD;
    const next = secondary[keep];
    if (next) {
      // Never lose the next segment silently: show as much of it as fits.
      const room = width - used - (kept.length > 0 ? separatorWidth : 0);
      const truncated = truncateSegment(next, ctx, room);
      if (truncated) {
        text = text ? `${text}${fg(ctx.theme, "separator", separator, ctx.colors)}${truncated}` : truncated;
        used += (kept.length > 0 ? separatorWidth : 0) + visibleWidth(truncated);
      }
    }
    if (text) {
      secondaryContent = ` ${text} `;
      if (visibleWidth(secondaryContent) > width) {
        secondaryContent = truncateToWidth(secondaryContent, width, "");
      }
    }
  }

  return { top, secondary: secondaryContent };
}
