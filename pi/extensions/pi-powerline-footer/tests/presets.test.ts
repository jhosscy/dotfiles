import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../presets.ts";
import { parsePowerlineConfig } from "../powerline-config.ts";
import type { StatusLinePreset } from "../types.ts";

const presetNames = Object.keys(PRESETS) as StatusLinePreset[];

test("lucy presets are available", () => {
  assert.equal(parsePowerlineConfig("lucy-cost", presetNames).preset, "lucy-cost");
  assert.equal(parsePowerlineConfig("lucy-mini", presetNames).preset, "lucy-mini");
});

test("lucy presets keep token display intent explicit", () => {
  assert.deepEqual(PRESETS.lucy.segmentOptions?.tokens, { format: "compact", showUnitPrices: false });
  assert.deepEqual(PRESETS["lucy-cost"].segmentOptions?.tokens, { format: "exact", showUnitPrices: true });
  assert.deepEqual(PRESETS["lucy-mini"].segmentOptions?.tokens, { format: "compact", showUnitPrices: false });
});

test("lucy-mini is narrow mobile layout", () => {
  assert.deepEqual(PRESETS["lucy-mini"].leftSegments, ["model", "git"]);
  assert.deepEqual(PRESETS["lucy-mini"].rightSegments, ["token_total", "cost", "context_pct"]);
  assert.deepEqual(PRESETS["lucy-mini"].secondarySegments, ["extension_statuses"]);
});
