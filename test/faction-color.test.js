import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACTION_COLORS,
  FACTION_HATCH_DEG,
  factionColor,
  factionHatchDeg,
} from "../js/ui/poi-style.js";
import { parseHex } from "../js/ui/theme.js";

const HEX = /^#[0-9a-f]{6}$/i;

function rgbDist(a, b) {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

test("faction palette is valid hex and not confusable with reserved marker colours", () => {
  assert.ok(FACTION_COLORS.length >= 6);
  // The map already uses these for other things; a faction colour that lands on
  // top of one would read as a selection/hook/party marker.
  const reserved = {
    selection: "#8a2418", // SELECTED_STROKE (oxblood)
    hookTarget: "#e8493a", // FOCUS_TARGET (red)
    party: "#ff4fd8", // party marker (magenta)
  };
  for (const c of FACTION_COLORS) {
    assert.match(c, HEX, `bad faction colour ${c}`);
    for (const [name, res] of Object.entries(reserved)) {
      assert.ok(rgbDist(c, res) > 45, `faction colour ${c} too close to ${name} (${res})`);
    }
  }
});

test("factionColor is stable and cycles safely (incl. negatives)", () => {
  assert.equal(factionColor(0), FACTION_COLORS[0]);
  assert.equal(factionColor(0), factionColor(0)); // deterministic
  assert.equal(factionColor(FACTION_COLORS.length), FACTION_COLORS[0]); // wraps
  assert.equal(factionColor(-1), FACTION_COLORS[FACTION_COLORS.length - 1]);
});

test("factionHatchDeg is stable and cycles safely", () => {
  assert.equal(factionHatchDeg(0), FACTION_HATCH_DEG[0]);
  assert.equal(factionHatchDeg(FACTION_HATCH_DEG.length), FACTION_HATCH_DEG[0]);
  assert.equal(factionHatchDeg(-1), FACTION_HATCH_DEG[FACTION_HATCH_DEG.length - 1]);
});

test("(colour, hatch) pairs stay distinct across many factions", () => {
  // Colour and hatch lists are different lengths (6 and 5), so the combined key
  // shouldn't repeat until lcm(6,5)=30 factions — every realistic roster is safe.
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const key = `${factionColor(i)}|${factionHatchDeg(i)}`;
    assert.ok(!seen.has(key), `duplicate (colour,hatch) at faction ${i}`);
    seen.add(key);
  }
  // Adjacent factions must differ in at least one channel (hue OR hatch).
  for (let i = 1; i < 12; i++) {
    const differ =
      factionColor(i) !== factionColor(i - 1) ||
      factionHatchDeg(i) !== factionHatchDeg(i - 1);
    assert.ok(differ, `factions ${i - 1} and ${i} are indistinguishable`);
  }
});
