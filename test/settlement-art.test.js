import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  SETTLEMENT_ART,
  SETTLEMENT_MARK,
  KEEP_ART,
  KEEP_MARK,
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

test("Thorp art is gone (tier dropped)", () => {
  assert.equal(SETTLEMENT_ART.Thorp, undefined);
  assert.equal(SETTLEMENT_MARK.Thorp, undefined);
  assert.ok(!existsSync("assets/settlement/thorp.svg"));
});

test("a Keep overrides the size art/mark with the martial sketch/glyph", () => {
  assert.ok(existsSync(KEEP_ART), `missing ${KEEP_ART}`);
  assert.ok(readFileSync(KEEP_ART, "utf8").trimStart().startsWith("<svg"), KEEP_ART);
  // kind "keep" wins at any size; no kind falls back to the size art
  assert.equal(settlementArt("City", "keep"), KEEP_ART);
  assert.equal(settlementArt("Hamlet", "keep"), KEEP_ART);
  assert.equal(settlementMark("City", "keep"), KEEP_MARK);
  assert.equal(settlementArt("Town"), SETTLEMENT_ART.Town);
  assert.equal(settlementMark("Town"), SETTLEMENT_MARK.Town);
});
