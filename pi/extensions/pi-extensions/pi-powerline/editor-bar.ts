/**
 * Draws the powerline inside the editor's top border.
 *
 * pi renders the editor as `renderTopBorder()` + content + bottom border, so the
 * first and last border lines of `render(width)` are plain `─` rows. Wrapping
 * the editor component lets the bar replace the top one and turns the whole
 * editor into a closed box:
 *
 *     ╭ π model · thinking · path · git · ↑in ↓out CH cost · 28k/200k ──────
 *     │  > your prompt
 *     ╰──────────────────────────────────────────────────────────────────────
 *
 * The content rows get a `│` edge plus one column of padding, so the three
 * pieces read as one box. The editor keeps its own prompt, cursor, wrapping and
 * working state.
 *
 * This is the same seam `pi-vim-editor` uses for its mode label, and it composes
 * with it in either load order: whichever extension wraps last calls the
 * previous factory, so the bar (top border) and the mode label (bottom border)
 * do not collide.
 */
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Same argument list pi passes to `setEditorComponent()` factories. */
type EditorFactoryArgs = ConstructorParameters<typeof CustomEditor>;

export type EditorFactoryLike = (
  tui: EditorFactoryArgs[0],
  theme: EditorFactoryArgs[1],
  keybindings: EditorFactoryArgs[2],
) => EditorComponent;

export interface EditorBarState {
  /** Whether the last editor render managed to draw the bar in its border. */
  attached: boolean;
}

export interface EditorBarOptions {
  /** Bar content for the given inner width, or null to leave the border alone. */
  renderBar(width: number): string | null;
  /** Style used for the `─` fill (and for the re-drawn scroll label). */
  border(text: string): string;
  state: EditorBarState;
}

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const LEFT_CORNERS = "╭┌╔╰└╚";
const RIGHT_CORNERS = "╮┐╗╯┘╝";
const SCROLL_LABEL = / [↑↓] \d+ more /;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

interface BorderShape {
  left: string;
  right: string;
  scroll?: string;
}

/**
 * Recognize a border line: optional corners, `─` fill, optional centered
 * `↑ N more` / `↓ N more` scroll label. Returns null for anything else, so an
 * editor that draws no border (or one another extension decorated) is left
 * untouched.
 */
function parseBorder(line: string): BorderShape | null {
  let plain = stripAnsi(line);
  const scrollMatch = plain.match(SCROLL_LABEL);
  const scroll = scrollMatch?.[0];
  if (scroll) plain = plain.replace(scroll, "");
  const left = LEFT_CORNERS.includes(plain[0] ?? "") ? plain[0]! : "";
  const right = RIGHT_CORNERS.includes(plain[plain.length - 1] ?? "") ? plain[plain.length - 1]! : "";
  const body = plain.slice(left.length, plain.length - right.length);
  if (!body || !/^─+$/.test(body)) return null;
  return { left, right, scroll };
}

/** Cheap check used to find the bottom border from the end of the render. */
function looksLikeBorder(line: string): boolean {
  return /^[─╭┌╔╰└╚]/.test(stripAnsi(line).trimEnd());
}

/**
 * Replace the top border with `corner + bar + fill + corner`, keeping any scroll
 * indicator pi drew there.
 */
function injectTopBorder(line: string, width: number, options: EditorBarOptions): string | null {
  const shape = parseBorder(line);
  if (!shape) return null;
  // pi draws a plain `─` border, so the bar would start mid-air. A leading
  // corner makes the box read as a box again; an editor that already draws one
  // keeps its own character.
  const left = shape.left || "╭";
  const right = shape.right;
  const fixed = visibleWidth(left) + visibleWidth(right) + visibleWidth(shape.scroll ?? "");
  const inner = width - fixed;
  if (inner <= 0) return null;
  const rawBar = options.renderBar(inner);
  if (!rawBar) return null;
  // Defensive: a bar wider than the border would push the line past the
  // terminal edge and break the box.
  const bar = visibleWidth(rawBar) > inner ? truncateToWidth(rawBar, inner, "") : rawBar;
  const fill = "─".repeat(Math.max(0, inner - visibleWidth(bar)));
  return `${left}${bar}${options.border(fill)}${shape.scroll ?? ""}${right}`;
}

/**
 * Close the box: `╰` + fill + `╯`, keeping the scroll label and any corner the
 * editor already drew. A bottom border another editor decorated (pi-vim-editor
 * appends its mode label to it) is left alone.
 */
function injectBottomBorder(line: string, width: number, options: EditorBarOptions): string {
  const shape = parseBorder(line);
  if (!shape) return line;
  const left = shape.left || "╰";
  const right = shape.right;
  const fixed = visibleWidth(left) + visibleWidth(right) + visibleWidth(shape.scroll ?? "");
  const fill = "─".repeat(Math.max(0, width - fixed));
  return `${left}${options.border(fill)}${shape.scroll ?? ""}${right}`;
}

/**
 * Draw the left edge of the box on a content row: `│` plus one column of
 * padding. The row is clipped by the same amount so the line keeps its width.
 */
function injectLeftEdge(line: string, width: number, options: EditorBarOptions): string {
  const room = width - 2;
  if (room <= 0) return line;
  const body = visibleWidth(line) > room ? truncateToWidth(line, room, "") : line;
  const pad = " ".repeat(Math.max(0, room - visibleWidth(body)));
  return `${options.border("│")} ${body}${pad}`;
}

function findBottomBorder(lines: readonly string[]): number {
  for (let i = lines.length - 1; i > 0; i--) {
    if (looksLikeBorder(lines[i]!)) return i;
  }
  return -1;
}

function wrapEditor(base: EditorComponent, options: EditorBarOptions): EditorComponent {
  const renderBase = base.render.bind(base);
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "render") {
        return (width: number): string[] => {
          const lines = renderBase(width);
          const top = lines[0];
          if (top === undefined) return lines;
          try {
            const bottom = findBottomBorder(lines);
            const injected = bottom > 0 ? injectTopBorder(top, width, options) : null;
            options.state.attached = injected !== null;
            if (injected !== null) {
              lines[0] = injected;
              lines[bottom] = injectBottomBorder(lines[bottom]!, width, options);
              for (let i = 1; i < bottom; i++) {
                lines[i] = injectLeftEdge(lines[i]!, width, options);
              }
            }
          } catch (error) {
            options.state.attached = false;
            console.debug("[powerline] editor bar render failed:", error);
          }
          return lines;
        };
      }
      // The bar owns the border line, so the working spinner must go back to
      // pi's status row instead of being painted over.
      if (property === "embedWorkingStatus") return false;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

/**
 * Compose with whatever editor is already installed (pi's default or another
 * extension's), so load order does not matter and the factory never wraps itself.
 */
export function createEditorBarFactory(
  baseFactory: EditorFactoryLike | undefined,
  options: EditorBarOptions,
): EditorFactoryLike {
  return (tui, theme, keybindings) => {
    const base = baseFactory
      ? baseFactory(tui, theme, keybindings)
      : (new CustomEditor(tui, theme, keybindings) as unknown as EditorComponent);
    return wrapEditor(base, options);
  };
}
