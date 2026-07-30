import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVING_CFG } from "../js/gen/culture.js";
import {
  washOpacity,
  cultureBand,
  contestedEdge,
  WASH_MIN_ALPHA,
  WASH_MAX_ALPHA,
  HEARTLAND_STRENGTH,
} from "../js/ui/culture-style.js";

test("washOpacity: Human / sub-threshold / zero strength gets no wash", () => {
  assert.equal(washOpacity(0), 0);
  assert.equal(washOpacity(LIVING_CFG.THRESHOLD - 0.01), 0);
  assert.equal(washOpacity(-1), 0);
});

test("washOpacity: floors at WASH_MIN at the membership threshold", () => {
  assert.ok(Math.abs(washOpacity(LIVING_CFG.THRESHOLD) - WASH_MIN_ALPHA) < 1e-9);
});

test("washOpacity: peaks at WASH_MAX at full strength and is monotonic", () => {
  assert.ok(Math.abs(washOpacity(1) - WASH_MAX_ALPHA) < 1e-9);
  let prev = -1;
  for (let s = LIVING_CFG.THRESHOLD; s <= 1.00001; s += 0.05) {
    const a = washOpacity(s);
    assert.ok(a >= prev, `opacity should not decrease with strength (s=${s})`);
    assert.ok(a >= WASH_MIN_ALPHA && a <= WASH_MAX_ALPHA);
    prev = a;
  }
});

test("cultureBand: heartland vs frontier splits at HEARTLAND_STRENGTH", () => {
  assert.equal(cultureBand(HEARTLAND_STRENGTH), "heartland");
  assert.equal(cultureBand(1), "heartland");
  assert.equal(cultureBand(HEARTLAND_STRENGTH - 0.01), "frontier");
  assert.equal(cultureBand(LIVING_CFG.THRESHOLD), "frontier");
});

test("contestedEdge: only when two DIFFERENT cultures meet (Human is never a rival)", () => {
  assert.equal(contestedEdge("elf", "dwarf"), true);
  assert.equal(contestedEdge("elf", "elf"), false);
  assert.equal(contestedEdge("elf", null), false);
  assert.equal(contestedEdge(null, "dwarf"), false);
  assert.equal(contestedEdge(null, null), false);
});
