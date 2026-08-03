import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  SETTLEMENT_ART,
  SETTLEMENT_MARK,
  KEEP_ART,
  KEEP_MARK,
  MONASTERY_ART,
  MONASTERY_MARK,
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
  // kind "keep" wins at any size; no kind falls back to the size art
  assert.equal(settlementArt("City", "keep"), KEEP_ART.City);
  assert.equal(settlementArt("Hamlet", "keep"), KEEP_ART.Hamlet);
  assert.equal(settlementMark("City", "keep"), KEEP_MARK);
  assert.equal(settlementArt("Town"), SETTLEMENT_ART.Town);
  assert.equal(settlementMark("Town"), SETTLEMENT_MARK.Town);
});

test("a Monastery overrides the size art/mark with the religious sketch/glyph", () => {
  assert.ok(typeof MONASTERY_MARK === "string" && MONASTERY_MARK.length > 0);
  // kind "monastery" wins at any size; no kind falls back to the size art
  assert.equal(settlementArt("City", "monastery"), MONASTERY_ART.City);
  assert.equal(settlementArt("Hamlet", "monastery"), MONASTERY_ART.Hamlet);
  assert.equal(settlementMark("Town", "monastery"), MONASTERY_MARK);
  // a plain size call is unaffected by the overlay
  assert.equal(settlementArt("Village"), SETTLEMENT_ART.Village);
  assert.equal(settlementMark("Village"), SETTLEMENT_MARK.Village);
});

// The sketch ladders by size for BOTH overlays; the zoomed-out glyph does not.
for (const [label, art] of [["Keep", KEEP_ART], ["Monastery", MONASTERY_ART]]) {
  test(`${label} art covers every size with a distinct SVG file`, () => {
    assert.deepEqual(Object.keys(art).sort(), [...SIZE_ORDER].sort());
    for (const size of SIZE_ORDER) {
      const url = art[size];
      assert.ok(existsSync(url), `missing ${url}`);
      assert.ok(readFileSync(url, "utf8").trimStart().startsWith("<svg"), url);
    }
    // every rank draws differently — that is the whole point of the ladder
    assert.equal(new Set(Object.values(art)).size, SIZE_ORDER.length);
  });
}

test("the zoomed-out marks stay single glyphs, not size maps", () => {
  assert.equal(typeof KEEP_MARK, "string");
  assert.equal(typeof MONASTERY_MARK, "string");
  for (const size of SIZE_ORDER) {
    assert.equal(settlementMark(size, "keep"), KEEP_MARK);
    assert.equal(settlementMark(size, "monastery"), MONASTERY_MARK);
  }
});
