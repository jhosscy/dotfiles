import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type DelegatedEditor = CustomEditor & {
  getExpandedText?: () => string;
  setAutocompleteProvider?: (provider: unknown) => void;
  setAutocompleteMaxVisible?: (maxVisible: number) => void;
  getAutocompleteMaxVisible?: () => number;
  setPaddingX?: (padding: number) => void;
  getPaddingX?: () => number;
  insertTextAtCursor?: (text: string) => void;
};

type VimMode = "normal" | "insert" | "visual";
type VimOperator = "d" | "c" | "y";

interface Pos {
  line: number;
  col: number;
}

interface VimMotion {
  pos: Pos;
  linewise?: boolean;
}

function isPrintableInput(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32;
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /\w/.test(ch));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isEditorBorderLine(line: string): boolean {
  const plain = stripAnsi(line);
  return plain.includes("─") && plain.trimStart().startsWith("─");
}

const ALT_PREFIX_TIMEOUT_MS = 120;

function firstNonBlank(text: string): number {
  const match = text.search(/\S/);
  return match === -1 ? 0 : match;
}

function nextWordStart(
  lines: string[],
  line: number,
  col: number,
  count: number,
): Pos {
  for (let n = 0; n < count; n++) {
    const text = lines[line] ?? "";

    if (col >= text.length) {
      if (line < lines.length - 1) {
        line++;
        col = 0;
      }
      continue;
    }

    if (/\s/.test(text[col] ?? "")) {
      while (col < text.length && /\s/.test(text[col] ?? "")) col++;
    } else {
      const word = isWordChar(text[col]);
      while (
        col < text.length && isWordChar(text[col]) === word &&
        !/\s/.test(text[col] ?? "")
      ) col++;
      while (col < text.length && /\s/.test(text[col] ?? "")) col++;
    }

    if (col >= text.length && line < lines.length - 1) {
      line++;
      col = 0;
      const nextText = lines[line] ?? "";
      while (col < nextText.length && /\s/.test(nextText[col] ?? "")) col++;
    }
  }
  return { line, col };
}

function prevWordStart(
  lines: string[],
  line: number,
  col: number,
  count: number,
): Pos {
  for (let n = 0; n < count; n++) {
    if (col === 0 && line > 0) {
      line--;
      col = (lines[line] ?? "").length;
    }

    const text = lines[line] ?? "";
    while (col > 0 && /\s/.test(text[col - 1] ?? "")) col--;
    if (col === 0) continue;

    const word = isWordChar(text[col - 1]);
    while (
      col > 0 && isWordChar(text[col - 1]) === word &&
      !/\s/.test(text[col - 1] ?? "")
    ) col--;
  }
  return { line, col };
}

function wordEnd(
  lines: string[],
  line: number,
  col: number,
  count: number,
): Pos {
  for (let n = 0; n < count; n++) {
    let text = lines[line] ?? "";
    col++;

    if (col >= text.length) {
      if (line < lines.length - 1) {
        line++;
        col = 0;
        text = lines[line] ?? "";
      } else {
        return { line, col: Math.max(0, text.length - 1) };
      }
    }

    while (col < text.length && /\s/.test(text[col] ?? "")) col++;
    if (col >= text.length) return { line, col: Math.max(0, text.length - 1) };

    const word = isWordChar(text[col]);
    while (
      col + 1 < text.length && isWordChar(text[col + 1]) === word &&
      !/\s/.test(text[col + 1] ?? "")
    ) col++;
  }
  return { line, col };
}


export class VimEditor extends CustomEditor {
  private readonly keybindingsRef: KeybindingsManager;
  private readonly base: DelegatedEditor | undefined;
  private vimMode: VimMode = "insert";
  private vimCount = 0;
  private vimOperator: VimOperator | null = null;
  private vimPendingG = false;
  private vimPendingReplace = false;
  private vimPendingInsertI = false;
  private vimVisualAnchor: Pos | null = null;
  private vimRegister = "";
  private vimRegisterLinewise = false;
  private pendingEscapeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(tui: any, theme: any, keybindings: KeybindingsManager, base?: DelegatedEditor) {
    super(tui, theme, keybindings);
    this.keybindingsRef = keybindings;
    this.base = base;
  }

  /**
   * Keep a wrapped editor wired as if it were the top-level editor.
   *
   * Pi only installs submit/exit/shortcut/autocomplete handlers on the editor
   * returned by the latest extension. When Vim wraps another editor and then
   * delegates input to it, those handlers must be forwarded explicitly so the
   * wrapped editor remains fully functional regardless of extension load order.
   */
  private syncBaseEditor(): void {
    if (!this.base) return;

    const base = this.base as any;
    base.focused = this.focused;
    base.onSubmit = this.onSubmit;
    base.onChange = this.onChange;
    base.onEscape = this.onEscape;
    base.onCtrlD = this.onCtrlD;
    base.onPasteImage = this.onPasteImage;
    base.onExtensionShortcut = this.onExtensionShortcut;

    if (base.actionHandlers instanceof Map) {
      for (const [action, handler] of this.actionHandlers) {
        base.actionHandlers.set(action, handler);
      }
    }
  }

  /** Delegate to the base editor when one is present, otherwise to the super class. */
  private delegateInput(data: string): void {
    if (this.base) {
      this.syncBaseEditor();
      this.base.handleInput(data);
    } else {
      super.handleInput(data);
    }
  }

  /** Delegate rendering to the base editor when one is present. */
  private delegateRender(width: number): string[] {
    if (!this.base) return super.render(width);
    this.syncBaseEditor();
    return this.base.render(width);
  }

  override invalidate(): void {
    this.base?.invalidate();
    super.invalidate();
  }

  override getText(): string {
    return this.base ? this.base.getText() : super.getText();
  }

  override getExpandedText(): string {
    if (!this.base) return super.getExpandedText();
    return this.base.getExpandedText?.() ?? this.base.getText();
  }

  override getLines(): string[] {
    return this.base ? this.base.getLines() : super.getLines();
  }

  override getCursor(): { line: number; col: number } {
    return this.base ? this.base.getCursor() : super.getCursor();
  }

  override setText(text: string): void {
    if (this.base) {
      this.syncBaseEditor();
      this.base.setText(text);
      return;
    }
    super.setText(text);
  }

  override insertTextAtCursor(text: string): void {
    if (this.base?.insertTextAtCursor) {
      this.syncBaseEditor();
      this.base.insertTextAtCursor(text);
      return;
    }
    super.insertTextAtCursor(text);
  }

  override addToHistory(text: string): void {
    if (this.base) {
      this.base.addToHistory(text);
      return;
    }
    super.addToHistory(text);
  }

  override setAutocompleteProvider(provider: any): void {
    if (this.base?.setAutocompleteProvider) {
      this.base.setAutocompleteProvider(provider);
      return;
    }
    super.setAutocompleteProvider(provider);
  }

  override setAutocompleteMaxVisible(maxVisible: number): void {
    if (this.base?.setAutocompleteMaxVisible) {
      this.base.setAutocompleteMaxVisible(maxVisible);
      return;
    }
    super.setAutocompleteMaxVisible(maxVisible);
  }

  override getAutocompleteMaxVisible(): number {
    return this.base?.getAutocompleteMaxVisible?.() ?? super.getAutocompleteMaxVisible();
  }

  override setPaddingX(padding: number): void {
    if (this.base?.setPaddingX) {
      this.base.setPaddingX(padding);
      return;
    }
    super.setPaddingX(padding);
  }

  override getPaddingX(): number {
    return this.base?.getPaddingX?.() ?? super.getPaddingX();
  }

  getVimModeLabel(): string {
    if (this.vimPendingInsertI) return " i_ ";
    if (this.vimMode === "visual") return " VISUAL ";
    if (this.vimPendingReplace) return " r_ ";
    if (this.vimPendingG) return ` ${this.vimCount > 0 ? this.vimCount : ""}g_ `;
    if (this.vimOperator) return ` ${this.vimCount > 1 ? this.vimCount : ""}${this.vimOperator}_ `;
    if (this.vimCount > 0) return ` ${this.vimCount}_ `;
    return this.vimMode === "normal" ? " NORMAL " : " INSERT ";
  }

  private getMatchingAppShortcuts(data: string): string[] {
    const matches: string[] = [];
    if (this.keybindingsRef.matches(data, "app.clipboard.pasteImage")) {
      matches.push("app.clipboard.pasteImage");
    }
    for (const action of this.actionHandlers.keys()) {
      if (this.keybindingsRef.matches(data, action)) matches.push(action);
    }
    return matches;
  }

  private shouldDelegateAppShortcut(data: string): boolean {
    return this.getMatchingAppShortcuts(data).length > 0;
  }

  private clearPendingEscape(): void {
    if (!this.pendingEscapeTimer) return;
    clearTimeout(this.pendingEscapeTimer);
    this.pendingEscapeTimer = null;
  }

  private flushPendingEscape(): void {
    this.clearPendingEscape();
    if (this.handleVimInput("\x1b")) return;
    this.delegateInput("\x1b");
  }

  private queueEscapeOrAltPrefix(): void {
    this.clearPendingEscape();
    this.pendingEscapeTimer = setTimeout(() => {
      this.pendingEscapeTimer = null;
      if (this.handleVimInput("\x1b")) return;
      this.delegateInput("\x1b");
    }, ALT_PREFIX_TIMEOUT_MS);
  }

  override handleInput(data: string): void {
    const pasteInProgress = data.includes("\x1b[200~") || Reflect.get(this, "isInPaste") === true;
    if (pasteInProgress || this.shouldDelegateAppShortcut(data)) {
      this.clearPendingEscape();
      this.delegateInput(data);
      return;
    }

    if (this.pendingEscapeTimer) {
      if (isPrintableInput(data)) {
        this.clearPendingEscape();
        const recombined = `\x1b${data}`;
        this.delegateInput(recombined);
        return;
      }
      this.flushPendingEscape();
    }

    if (data === "\x1b") {
      this.queueEscapeOrAltPrefix();
      return;
    }

    // Insert mode should behave like Pi's original editor. Only the custom
    // "ii" escape sequence is intercepted; every other key chord, including
    // alt/meta bindings such as Alt+V, is left to the wrapped editor. Escape is
    // queued above so legacy terminals can still form ESC+v => alt+v.
    if (this.vimMode === "insert" && !this.vimPendingInsertI) {
      if (data === "i") {
        this.vimPendingInsertI = true;
        this.tui.requestRender();
        return;
      }
      this.delegateInput(data);
      return;
    }

    if (this.handleVimInput(data)) return;
    this.delegateInput(data);
  }

  override render(width: number): string[] {
    const lines = [...this.delegateRender(width)];
    if (lines.length === 0) return lines;

    const label = this.getVimModeLabel();
    const border = lines.findLastIndex(isEditorBorderLine);
    const target = border === -1 ? lines.length - 1 : border;
    if (visibleWidth(lines[target] ?? "") >= label.length) {
      lines[target] = truncateToWidth(lines[target] ?? "", width - label.length, "") + label;
    }
    return lines;
  }

  private handleVimInput(data: string): boolean {
    if (this.vimMode === "insert") {
      return this.handleVimInsertInput(data);
    }

    if (this.keybindingsRef.matches(data, "app.interrupt")) {
      if (this.vimMode === "visual") {
        this.exitVimVisualMode();
        return true;
      }
      this.resetVimPending();
      return false;
    }

    if (this.vimPendingReplace) {
      this.vimPendingReplace = false;
      if (isPrintableInput(data)) {
        this.replaceChars(data, this.vimEffectiveCount());
      }
      this.resetVimPending();
      return true;
    }

    if (this.vimPendingG) {
      this.vimPendingG = false;
      if (data === "g") {
        this.gotoLine(this.vimCount > 0 ? this.vimCount - 1 : 0);
      }
      this.resetVimPending();
      return true;
    }

    if (data.length > 1 || data.charCodeAt(0) < 32) {
      this.resetVimPending();
      return false;
    }

    if (this.vimMode === "visual") {
      this.handleVimVisualInput(data);
      return true;
    }

    if (this.vimOperator) {
      this.handleVimOperatorInput(data);
      return true;
    }

    if (this.handleVimCountInput(data)) return true;

    this.handleVimNormalInput(data);
    return true;
  }

  private handleVimInsertInput(data: string): boolean {
    if (this.keybindingsRef.matches(data, "app.interrupt")) {
      this.vimPendingInsertI = false;
      return false;
    }

    if (this.vimPendingInsertI) {
      this.vimPendingInsertI = false;
      if (data === "i") {
        this.vimMode = "normal";
        this.resetVimPending();
        this.tui.requestRender();
        return true;
      }

      this.delegateInput("i");
      return false;
    }

    if (data === "i") {
      this.vimPendingInsertI = true;
      this.tui.requestRender();
      return true;
    }

    return false;
  }

  private handleVimCountInput(data: string): boolean {
    if (this.vimCount > 0 && data >= "0" && data <= "9") {
      this.vimCount = Math.min(9999, this.vimCount * 10 + Number(data));
      this.tui.requestRender();
      return true;
    }

    if (data >= "1" && data <= "9") {
      this.vimCount = Number(data);
      this.tui.requestRender();
      return true;
    }

    return false;
  }

  private handleVimNormalInput(data: string): void {
    const count = this.vimEffectiveCount();

    switch (data) {
      case "h":
        this.repeatInput("\x1b[D", count);
        break;
      case "j":
        this.repeatInput("\x1b[B", count);
        break;
      case "k":
        this.repeatInput("\x1b[A", count);
        break;
      case "l":
        this.repeatInput("\x1b[C", count);
        break;
      case "0":
        this.delegateInput("\x01");
        break;
      case "$":
        this.delegateInput("\x05");
        break;
      case "^":
        this.gotoFirstNonBlank();
        break;
      case "w":
        this.moveTo(
          nextWordStart(
            this.getLines(),
            this.getCursor().line,
            this.getCursor().col,
            count,
          ),
        );
        break;
      case "b":
        this.moveTo(
          prevWordStart(
            this.getLines(),
            this.getCursor().line,
            this.getCursor().col,
            count,
          ),
        );
        break;
      case "e":
        this.moveTo(
          wordEnd(
            this.getLines(),
            this.getCursor().line,
            this.getCursor().col,
            count,
          ),
        );
        break;
      case "g":
        this.vimPendingG = true;
        this.tui.requestRender();
        return;
      case "G":
        this.gotoLine(
          this.vimCount > 0 ? this.vimCount - 1 : this.getLines().length - 1,
        );
        break;
      case "v":
        this.vimMode = "visual";
        this.vimCount = 0;
        this.vimVisualAnchor = this.getCursor();
        this.tui.requestRender();
        return;
      case "i":
        this.vimMode = "insert";
        this.tui.requestRender();
        break;
      case "a":
        if (!this.isCursorAtEndOfLine()) this.delegateInput("\x1b[C");
        this.vimMode = "insert";
        this.tui.requestRender();
        break;
      case "I":
        this.gotoFirstNonBlank();
        this.vimMode = "insert";
        this.tui.requestRender();
        break;
      case "A":
        this.delegateInput("\x05");
        this.vimMode = "insert";
        this.tui.requestRender();
        break;
      case "o":
        this.openLineBelow();
        break;
      case "O":
        this.openLineAbove();
        break;
      case "x":
        this.deleteChars(count);
        break;
      case "X":
        this.backspaceChars(count);
        break;
      case "D":
        this.deleteToEnd();
        break;
      case "C":
        this.deleteToEnd();
        this.vimMode = "insert";
        this.tui.requestRender();
        break;
      case "J":
        this.joinLines(count);
        break;
      case "r":
        this.vimPendingReplace = true;
        this.tui.requestRender();
        return;
      case "u":
        this.repeatInput("\x1f", count);
        break;
      case "p":
        this.pasteRegister(false);
        break;
      case "P":
        this.pasteRegister(true);
        break;
      case "d":
      case "c":
      case "y":
        this.vimOperator = data;
        this.tui.requestRender();
        return;
      default:
        break;
    }

    this.resetVimPending();
  }

  private handleVimVisualInput(data: string): void {
    if (this.vimPendingInsertI) {
      this.vimPendingInsertI = false;
      if (data === "i") this.exitVimVisualMode();
      return;
    }

    if (data === "i") {
      this.vimPendingInsertI = true;
      this.tui.requestRender();
      return;
    }

    if (this.handleVimCountInput(data)) return;

    const count = this.vimEffectiveCount();
    switch (data) {
      case "v":
        this.exitVimVisualMode();
        return;
      case "h":
        this.repeatInput("\x1b[D", count);
        break;
      case "j":
        this.repeatInput("\x1b[B", count);
        break;
      case "k":
        this.repeatInput("\x1b[A", count);
        break;
      case "l":
        this.repeatInput("\x1b[C", count);
        break;
      case "0":
        this.delegateInput("\x01");
        break;
      case "$":
        this.delegateInput("\x05");
        break;
      case "^":
        this.gotoFirstNonBlank();
        break;
      case "w":
        this.moveTo(
          nextWordStart(this.getLines(), this.getCursor().line, this.getCursor().col, count),
        );
        break;
      case "b":
        this.moveTo(
          prevWordStart(this.getLines(), this.getCursor().line, this.getCursor().col, count),
        );
        break;
      case "e":
        this.moveTo(
          wordEnd(this.getLines(), this.getCursor().line, this.getCursor().col, count),
        );
        break;
      case "g":
        this.vimPendingG = true;
        this.tui.requestRender();
        return;
      case "G":
        this.gotoLine(
          this.vimCount > 0 ? this.vimCount - 1 : this.getLines().length - 1,
        );
        break;
      case "y":
      case "d":
      case "c":
        this.executeVimVisualOperator(data);
        return;
      default:
        break;
    }

    this.vimCount = 0;
    this.tui.requestRender();
  }

  private handleVimOperatorInput(data: string): void {
    const op = this.vimOperator;
    if (!op) return;
    const count = this.vimEffectiveCount();

    if (data === op) {
      this.executeLinewise(op, count);
      this.resetVimPending();
      return;
    }

    const motion = this.resolveVimMotion(data, count);
    if (motion) {
      this.executeOperatorMotion(op, motion);
    }
    this.resetVimPending();
  }

  private resolveVimMotion(data: string, count: number): VimMotion | null {
    const lines = this.getLines();
    const cur = this.getCursor();

    switch (data) {
      case "h":
        return { pos: { line: cur.line, col: Math.max(0, cur.col - count) } };
      case "l":
        return { pos: { line: cur.line, col: cur.col + count } };
      case "j":
        return {
          pos: { line: Math.min(lines.length - 1, cur.line + count), col: 0 },
          linewise: true,
        };
      case "k":
        return {
          pos: { line: Math.max(0, cur.line - count), col: 0 },
          linewise: true,
        };
      case "w":
        return { pos: nextWordStart(lines, cur.line, cur.col, count) };
      case "b":
        return { pos: prevWordStart(lines, cur.line, cur.col, count) };
      case "e": {
        const pos = wordEnd(lines, cur.line, cur.col, count);
        return { pos: { line: pos.line, col: pos.col + 1 } };
      }
      case "0":
        return { pos: { line: cur.line, col: 0 } };
      case "$":
        return { pos: { line: cur.line, col: (lines[cur.line] ?? "").length } };
      case "^":
        return {
          pos: { line: cur.line, col: firstNonBlank(lines[cur.line] ?? "") },
        };
      case "G":
        return {
          pos: {
            line: this.vimCount > 0 ? this.vimCount - 1 : lines.length - 1,
            col: 0,
          },
          linewise: true,
        };
      default:
        return null;
    }
  }

  private executeOperatorMotion(op: VimOperator, motion: VimMotion): void {
    const cur = this.getCursor();
    const target = this.clampPos(motion.pos);

    if (motion.linewise) {
      this.executeLinewiseRange(op, cur.line, target.line);
      return;
    }

    if (
      target.line < cur.line ||
      (target.line === cur.line && target.col < cur.col)
    ) {
      this.executeCharRange(op, target, cur);
    } else {
      this.executeCharRange(op, cur, target);
    }
  }

  private executeVimVisualOperator(op: VimOperator): void {
    const range = this.getVimVisualRange();
    if (!range) {
      this.exitVimVisualMode();
      return;
    }

    if (op === "y") {
      this.vimRegister = this.sliceRange(this.getLines(), range.from, range.to);
      this.vimRegisterLinewise = false;
      this.exitVimVisualMode();
      return;
    }

    this.executeCharRange(op, range.from, range.to);
    this.vimVisualAnchor = null;
    if (op !== "c") this.vimMode = "normal";
    this.resetVimPending();
    this.tui.requestRender();
  }

  private getVimVisualRange(): { from: Pos; to: Pos } | null {
    const anchor = this.clampPos(this.vimVisualAnchor ?? this.getCursor());
    const cursor = this.clampPos(this.getCursor());
    const forward = this.comparePos(anchor, cursor) <= 0;
    const from = forward ? anchor : cursor;
    const inclusiveTo = forward ? cursor : anchor;
    const to = this.advancePos(inclusiveTo);

    return this.comparePos(from, to) < 0 ? { from, to } : null;
  }

  private advancePos(pos: Pos): Pos {
    const lines = this.getLines();
    const lineText = lines[pos.line] ?? "";
    if (pos.col < lineText.length) return { line: pos.line, col: pos.col + 1 };
    if (pos.line < lines.length - 1) return { line: pos.line + 1, col: 0 };
    return pos;
  }

  private comparePos(a: Pos, b: Pos): number {
    if (a.line !== b.line) return a.line - b.line;
    return a.col - b.col;
  }

  private exitVimVisualMode(): void {
    this.vimMode = "normal";
    this.vimVisualAnchor = null;
    this.resetVimPending();
    this.tui.requestRender();
  }

  private executeLinewise(op: VimOperator, count: number): void {
    const cur = this.getCursor();
    this.executeLinewiseRange(op, cur.line, cur.line + count - 1);
  }

  private executeLinewiseRange(
    op: VimOperator,
    startLine: number,
    endLine: number,
  ): void {
    const lines = this.getLines();
    const start = Math.max(0, Math.min(startLine, endLine));
    const end = Math.min(lines.length - 1, Math.max(startLine, endLine));
    const yanked = lines.slice(start, end + 1).join("\n");

    this.vimRegister = yanked;
    this.vimRegisterLinewise = true;
    if (op === "y") return;

    const next = [...lines];
    if (op === "c") {
      next.splice(start, end - start + 1, "");
      this.performSurgery(next, start, 0);
      this.vimMode = "insert";
      return;
    }

    next.splice(start, end - start + 1);
    if (next.length === 0) next.push("");
    this.performSurgery(next, Math.min(start, next.length - 1), 0);
  }

  private executeCharRange(op: VimOperator, from: Pos, to: Pos): void {
    const lines = this.getLines();
    const start = this.clampPos(from);
    const end = this.clampPos(to);

    if (start.line === end.line && start.col === end.col) return;

    const deleted = this.sliceRange(lines, start, end);
    this.vimRegister = deleted;
    this.vimRegisterLinewise = false;
    if (op === "y") return;

    const next = [...lines];
    if (start.line === end.line) {
      const line = next[start.line] ?? "";
      next[start.line] = line.slice(0, start.col) + line.slice(end.col);
    } else {
      const first = next[start.line] ?? "";
      const last = next[end.line] ?? "";
      next.splice(
        start.line,
        end.line - start.line + 1,
        first.slice(0, start.col) + last.slice(end.col),
      );
    }

    this.performSurgery(next, start.line, start.col);
    if (op === "c") this.vimMode = "insert";
  }

  private sliceRange(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) {
      return (lines[from.line] ?? "").slice(from.col, to.col);
    }

    const parts = [(lines[from.line] ?? "").slice(from.col)];
    for (let line = from.line + 1; line < to.line; line++) {
      parts.push(lines[line] ?? "");
    }
    parts.push((lines[to.line] ?? "").slice(0, to.col));
    return parts.join("\n");
  }

  private deleteChars(count: number): void {
    const cur = this.getCursor();
    const line = this.getLines()[cur.line] ?? "";
    this.executeCharRange("d", cur, {
      line: cur.line,
      col: Math.min(line.length, cur.col + count),
    });
  }

  private backspaceChars(count: number): void {
    const cur = this.getCursor();
    this.executeCharRange("d", {
      line: cur.line,
      col: Math.max(0, cur.col - count),
    }, cur);
  }

  private deleteToEnd(): void {
    const cur = this.getCursor();
    const line = this.getLines()[cur.line] ?? "";
    this.executeCharRange("d", cur, { line: cur.line, col: line.length });
  }

  private pasteRegister(before: boolean): void {
    if (!this.vimRegister) return;

    const lines = this.getLines();
    const cur = this.getCursor();

    if (this.vimRegisterLinewise) {
      const next = [...lines];
      const insertAt = before ? cur.line : cur.line + 1;
      next.splice(insertAt, 0, ...this.vimRegister.split("\n"));
      this.performSurgery(next, insertAt, 0);
      return;
    }

    const line = lines[cur.line] ?? "";
    const insertCol = before ? cur.col : Math.min(cur.col + 1, line.length);
    const next = [...lines];
    next[cur.line] = line.slice(0, insertCol) + this.vimRegister +
      line.slice(insertCol);
    this.performSurgery(next, cur.line, insertCol + this.vimRegister.length);
  }

  private openLineBelow(): void {
    const lines = this.getLines();
    const cur = this.getCursor();
    const next = [...lines];
    next.splice(cur.line + 1, 0, "");
    this.performSurgery(next, cur.line + 1, 0);
    this.vimMode = "insert";
  }

  private openLineAbove(): void {
    const lines = this.getLines();
    const cur = this.getCursor();
    const next = [...lines];
    next.splice(cur.line, 0, "");
    this.performSurgery(next, cur.line, 0);
    this.vimMode = "insert";
  }

  private joinLines(count: number): void {
    const lines = this.getLines();
    const cur = this.getCursor();
    if (cur.line >= lines.length - 1) return;

    const next = [...lines];
    const joinCol = (next[cur.line] ?? "").length;
    const joins = Math.min(count, next.length - cur.line - 1);
    for (let i = 0; i < joins; i++) {
      const current = next[cur.line] ?? "";
      const following = (next[cur.line + 1] ?? "").trimStart();
      next[cur.line] = `${current} ${following}`;
      next.splice(cur.line + 1, 1);
    }
    this.performSurgery(next, cur.line, joinCol);
  }

  private replaceChars(char: string, count: number): void {
    const lines = this.getLines();
    const cur = this.getCursor();
    const line = lines[cur.line] ?? "";
    if (cur.col >= line.length) return;

    const endCol = Math.min(line.length, cur.col + count);
    const next = [...lines];
    next[cur.line] = line.slice(0, cur.col) + char.repeat(endCol - cur.col) +
      line.slice(endCol);
    this.performSurgery(next, cur.line, cur.col);
  }

  private gotoFirstNonBlank(): void {
    const cur = this.getCursor();
    this.moveTo({
      line: cur.line,
      col: firstNonBlank(this.getLines()[cur.line] ?? ""),
    });
  }

  private gotoLine(line: number): void {
    this.moveTo({ line, col: 0 });
  }

  private moveTo(pos: Pos): void {
    const target = this.clampPos(pos);
    this.delegateInput("\x01");

    const currentLine = this.getCursor().line;
    const delta = target.line - currentLine;
    this.repeatInput(delta > 0 ? "\x1b[B" : "\x1b[A", Math.abs(delta));
    this.delegateInput("\x01");
    this.repeatInput("\x1b[C", target.col);
  }

  private performSurgery(
    newLines: string[],
    targetLine: number,
    targetCol: number,
  ): void {
    if (newLines.length === 0) newLines.push("");

    this.setText(newLines.join("\n"));
    this.delegateInput("\x01");
    this.repeatInput("\x1b[A", Math.max(0, newLines.length - 1));
    this.moveTo({ line: targetLine, col: targetCol });
  }

  private clampPos(pos: Pos): Pos {
    const lines = this.getLines();
    const line = Math.max(0, Math.min(pos.line, Math.max(0, lines.length - 1)));
    const col = Math.max(0, Math.min(pos.col, (lines[line] ?? "").length));
    return { line, col };
  }

  private repeatInput(input: string, count: number): void {
    for (let i = 0; i < count; i++) {
      this.delegateInput(input);
    }
  }

  private vimEffectiveCount(): number {
    return Math.max(1, this.vimCount || 1);
  }

  private resetVimPending(): void {
    this.vimCount = 0;
    this.vimOperator = null;
    this.vimPendingG = false;
    this.vimPendingReplace = false;
    this.vimPendingInsertI = false;
  }

  private isCursorAtEndOfLine(): boolean {
    const cur = this.getCursor();
    return cur.col >= (this.getLines()[cur.line] ?? "").length;
  }

}

export default VimEditor;
