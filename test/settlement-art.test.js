import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  SETTLEMENT_ART,
  SETTLEMENT_MARK,
  settlementArt,
  settlementMark,
} from "../js/ui/settlement-art.js";
import { SIZE_ORDER } from "../js/gen/terrain-profile.js";

test("every settlement size has a sketch file that is an SVG", () => {
  for (const size of SIZE_ORDER) {
    const url = settlementArt(size);
    assert.ok(url, `no art for ${size}`);
    assert.ok(existsSync(url), `missing ${url}`);
    assert.ok(readFileSync(url, "utf8").trimStart().startsWith("<svg"), url);
  }
});

test("every settlement size has a zoomed-out marker", () => {
  for (const size of SIZE_ORDER) {
    assert.ok(settlementMark(size), `no marker for ${size}`);
  }
  // sanity: the maps cover exactly the known sizes
  assert.deepEqual(Object.keys(SETTLEMENT_ART).sort(), [...SIZE_ORDER].sort());
  assert.deepEqual(Object.keys(SETTLEMENT_MARK).sort(), [...SIZE_ORDER].sort());
});
