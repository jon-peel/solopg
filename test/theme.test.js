import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PALETTE,
  TERRAIN_COLORS,
  UNKNOWN_COLOR,
  SELECTED_STROKE,
  parseHex,
  relativeLuminance,
  contrastRatio,
  meetsAA,
} from "../js/ui/theme.js";

const HEX = /^#[0-9a-f]{6}$/i;

test("palette exposes the required semantic tokens as valid hex", () => {
  const required = [
    "paper",
    "paperPanel",
    "paperBar",
    "paperRaised",
    "paperSunk",
    "ink",
    "inkSoft",
    "inkFaint",
    "edge",
    "edgeStrong",
    "accent",
    "accent2",
    "gold",
    "danger",
  ];
  for (const key of required) {
    assert.ok(key in PALETTE, `missing token ${key}`);
    assert.match(PALETTE[key], HEX, `${key} is not #rrggbb: ${PALETTE[key]}`);
  }
});

test("canvas terrain constants are valid hex", () => {
  for (const [name, hex] of Object.entries(TERRAIN_COLORS)) {
    assert.match(hex, HEX, `${name} fill is not #rrggbb: ${hex}`);
  }
  assert.match(UNKNOWN_COLOR, HEX);
  assert.match(SELECTED_STROKE, HEX);
});

test("parseHex handles #rgb and #rrggbb, rejects junk", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("#000000"), [0, 0, 0]);
  assert.deepEqual(parseHex("#8a3324"), [138, 51, 36]);
  assert.throws(() => parseHex("red"));
  assert.throws(() => parseHex("#12"));
});

test("contrast ratio matches known WCAG anchors", () => {
  // Black-on-white is the maximum, 21:1; identical colours are 1:1.
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#777777", "#777777") - 1) < 0.001);
  // Symmetric regardless of argument order.
  assert.equal(
    contrastRatio(PALETTE.ink, PALETTE.paper),
    contrastRatio(PALETTE.paper, PALETTE.ink),
  );
  assert.ok(relativeLuminance("#ffffff") > relativeLuminance("#000000"));
});

test("body ink on parchment passes WCAG AA for normal text", () => {
  const ratio = contrastRatio(PALETTE.ink, PALETTE.paper);
  assert.ok(ratio >= 4.5, `ink-on-paper only ${ratio.toFixed(2)}:1`);
  assert.ok(meetsAA(PALETTE.ink, PALETTE.paper));
});

test("muted ink and accent stay legible on the panel surface", () => {
  // Secondary text is smaller-but-still-body — hold it to AA large (3:1) at least.
  assert.ok(meetsAA(PALETTE.inkSoft, PALETTE.paperPanel, true));
  assert.ok(meetsAA(PALETTE.accent, PALETTE.paperPanel, true));
});
