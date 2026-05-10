import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("stash shortcut is registered without editor character hacks", () => {
  assert.match(source, /pi\.registerShortcut\("alt\+s"/);
  assert.match(source, /function stashOrRestoreEditorText\(ctx: any\): void/);
  assert.doesNotMatch(source, /if \(data === "ß"\)/);
});
