// Terrain generation v2 (Phase 3R.3 + 3R.4) — aggregate coherence assertions
// over a real generated area. Distribution/adjacency checks, not exact-art
// snapshots, per the phase doc: lone-hex rate well below the pre-3R.3
// baseline (23-25%, see docs/plans/phase-3r-world-coherence.md), Mountains
// forming real multi-hex runs rather than speckle, and (3R.4, revised) Sea
// forming genuinely large contiguous coastal bodies — not an oversized inland
// lake — with the world's fixed origin always landing on land. Also the
// concrete regression test for "determinism under area generation" — since
// terrain is now a pure function of (seed, q, r), fill order must never
// affect the result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, addHex, placedHexes, getHex } from "../js/world/world.js";
import { generateHex } from "../js/gen/hex.js";
import { subRng } from "../js/core/rng.js";
import { axialKey, neighbors, hexDisc } from "../js/core/hexgeo.js";

const HEX_TABLE_IDS = [
  "terrain", "swamp-feature", "settlement-size",
  "poi-types", "poi-occupant", "creatures", "occupiers",
];

function loadTables() {
  const t = new Map();
  for (const id of HEX_TABLE_IDS) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

function generateArea(seed, radius, coordsInOrder) {
  const tables = loadTables();
  const world = createWorld({ name: "coherence-test", seed });
  for (const { q, r } of coordsInOrder) {
    const rng = subRng(seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r), coords: { q, r }, placed: true, seed, gen: 0,
    });
    hex.gen = 0;
    addHex(world, hex);
  }
  return world;
}

// Connected components of same-terrain adjacent hexes (BFS).
function clumps(hexes) {
  const byKey = new Map(hexes.map((h) => [axialKey(h.coords.q, h.coords.r), h]));
  const seen = new Set();
  const sizesByTerrain = new Map();
  let loneCount = 0;
  for (const h of hexes) {
    const key = axialKey(h.coords.q, h.coords.r);
    if (seen.has(key)) continue;
    const queue = [h];
    seen.add(key);
    let size = 0;
    while (queue.length) {
      const cur = queue.pop();
      size++;
      for (const n of neighbors(cur.coords.q, cur.coords.r)) {
        const nKey = axialKey(n.q, n.r);
        const nh = byKey.get(nKey);
        if (nh && nh.terrain === h.terrain && !seen.has(nKey)) {
          seen.add(nKey);
          queue.push(nh);
        }
      }
    }
    if (!sizesByTerrain.has(h.terrain)) sizesByTerrain.set(h.terrain, []);
    sizesByTerrain.get(h.terrain).push(size);
    if (size === 1) loneCount++;
  }
  return { sizesByTerrain, loneCount };
}

const RADIUS = 25; // ~1951 hexes, matches the 3R.2 baseline sample size

test("lone-hex rate is well below the pre-3R.3 baseline (23-25%)", () => {
  const world = generateArea(1, RADIUS, hexDisc(0, 0, RADIUS));
  const hexes = placedHexes(world);
  const { loneCount } = clumps(hexes);
  const rate = loneCount / hexes.length;
  assert.ok(rate < 0.15, `lone-hex rate ${(rate * 100).toFixed(1)}% should be < 15%`);
});

test("Mountains form multi-hex runs, not speckle", () => {
  const world = generateArea(1, RADIUS, hexDisc(0, 0, RADIUS));
  const hexes = placedHexes(world);
  const { sizesByTerrain } = clumps(hexes);
  const mountainSizes = sizesByTerrain.get("Mountains") || [];
  assert.ok(mountainSizes.length > 0, "expected some Mountains in this sample");
  const mean = mountainSizes.reduce((s, v) => s + v, 0) / mountainSizes.length;
  assert.ok(mean >= 4, `Mountains mean clump size ${mean.toFixed(1)} should be >= 4`);
  assert.ok(Math.max(...mountainSizes) >= 8, "expected at least one Mountains run >= 8 hexes");
});

// Continent-scale features span ~65 hexes (js/gen/biome.js CONTINENT_OPTS),
// far bigger than RADIUS=25's ~1951-hex sample — at that scale, a sample can
// legitimately show zero Sea (verified: seed 1 does, at RADIUS=25). That's
// correct now that Sea is a real coastline/ocean gate, not a per-hex label —
// so the "both appear" and "Sea is a real ocean" checks use a bigger sample.
const CONTINENT_RADIUS = 70; // ~14911 hexes

test("Lake and Sea (3R.4) both appear at continent scale", () => {
  const world = generateArea(1, CONTINENT_RADIUS, hexDisc(0, 0, CONTINENT_RADIUS));
  const hexes = placedHexes(world);
  const lakeCount = hexes.filter((h) => h.terrain === "Lake").length;
  const seaCount = hexes.filter((h) => h.terrain === "Sea").length;
  assert.ok(lakeCount > 0, "expected some Lake hexes");
  assert.ok(seaCount > 0, "expected some Sea hexes");
});

test("Sea forms a genuinely large, contiguous coastal body — not scattered inland pockets", () => {
  // The bug this guards against: an earlier design decided Sea vs Lake from
  // an independent noise field uncorrelated with elevation, so "Sea" read as
  // an oversized inland lake rather than an ocean. Sea should now form very
  // few, very large clumps — Lake stays pocket-sized by contrast.
  const world = generateArea(1, CONTINENT_RADIUS, hexDisc(0, 0, CONTINENT_RADIUS));
  const hexes = placedHexes(world);
  const { sizesByTerrain } = clumps(hexes);
  const seaSizes = sizesByTerrain.get("Sea") || [];
  const lakeSizes = sizesByTerrain.get("Lake") || [];
  assert.ok(seaSizes.length > 0 && seaSizes.length <= 5, `expected a handful of Sea clumps, got ${seaSizes.length}`);
  const seaMean = seaSizes.reduce((s, v) => s + v, 0) / seaSizes.length;
  const lakeMean = lakeSizes.reduce((s, v) => s + v, 0) / lakeSizes.length;
  assert.ok(seaMean >= 500, `Sea mean clump size ${seaMean.toFixed(1)} should be >= 500 (a real ocean)`);
  assert.ok(seaMean > lakeMean * 10, `Sea (${seaMean.toFixed(1)}) should dwarf Lake (${lakeMean.toFixed(1)}) in size`);
});

test("the world origin (0,0) is always land, never Sea", () => {
  // The fixed spawn point (app.js onNewWorld) must never land in the ocean.
  for (const seed of [1, 2, 3, "alpha", 999]) {
    const world = generateArea(seed, 0, [{ q: 0, r: 0 }]);
    assert.notEqual(getHex(world, 0, 0).terrain, "Sea", `seed ${seed} put Sea at the origin`);
  }
});

test("generation is deterministic: same seed -> identical terrain everywhere", () => {
  const a = generateArea(42, 10, hexDisc(0, 0, 10));
  const b = generateArea(42, 10, hexDisc(0, 0, 10));
  for (const { q, r } of hexDisc(0, 0, 10)) {
    assert.equal(getHex(a, q, r).terrain, getHex(b, q, r).terrain);
    assert.equal(getHex(a, q, r).elevation, getHex(b, q, r).elevation);
  }
});

test("order-independence: forward vs. reverse fill order give identical per-hex terrain", () => {
  const coords = hexDisc(0, 0, 10);
  const forward = generateArea(7, 10, coords);
  const reverse = generateArea(7, 10, [...coords].reverse());
  for (const { q, r } of coords) {
    assert.equal(getHex(forward, q, r).terrain, getHex(reverse, q, r).terrain);
    assert.equal(getHex(forward, q, r).elevation, getHex(reverse, q, r).elevation);
    assert.equal(getHex(forward, q, r).moisture, getHex(reverse, q, r).moisture);
    assert.equal(getHex(forward, q, r).continent, getHex(reverse, q, r).continent);
  }
});
