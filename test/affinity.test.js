import { test } from "node:test";
import assert from "node:assert/strict";
import { terrainAt, neighborTerrainsOf, TERRAINS, WATER_TERRAINS } from "../js/gen/affinity.js";
import { hexDisc, neighbors, axialKey } from "../js/core/hexgeo.js";

// Generate a disc ring-by-ring from the origin, collecting each hex's already-
// placed neighbours to bias its roll — mirrors how app.js reveals terrain.
function generateArea(seed, radius) {
  const map = new Map();
  for (const { q, r } of hexDisc(0, 0, radius)) {
    const nts = neighborTerrainsOf(q, r, (nq, nr) => map.get(axialKey(nq, nr)));
    map.set(axialKey(q, r), terrainAt(seed, q, r, nts));
  }
  return map;
}

test("terrainAt: always returns one of the affinity terrains", () => {
  for (let i = 0; i < 200; i++) {
    const t = terrainAt("seed", i, -i, []);
    assert.ok(TERRAINS.includes(t), `unexpected terrain ${t}`);
  }
});

test("terrainAt: the world origin (0,0) with no neighbours spawns on land", () => {
  for (const seed of ["a", "b", "c", 1, 2, 3]) {
    const t = terrainAt(seed, 0, 0, []);
    assert.ok(!WATER_TERRAINS.has(t), `origin should be land, got ${t}`);
  }
});

test("terrainAt: deterministic for the same (seed, q, r, neighbours)", () => {
  const nts = ["Forest", "Plains", "Hills"];
  assert.equal(terrainAt("s", 4, 2, nts), terrainAt("s", 4, 2, nts));
});

test("terrainAt: majority neighbour wins decisively (Sea conforms; Mountains -> highland)", () => {
  // Self-affinity is cranked, so a fully-surrounded hex conforms. Sea is near-
  // absolute (it discourages every other terrain). A mountain-ringed hex is
  // highland (Mountains or Hills) — mountains strongly seed adjacent hills
  // (foothills), which is the gradient we want, so allow either.
  let sea = 0, highland = 0, mtn = 0;
  for (let i = 0; i < 50; i++) {
    if (terrainAt("s", i, 7, Array(6).fill("Sea")) === "Sea") sea++;
    const m = terrainAt("s", i, 9, Array(6).fill("Mountains"));
    if (m === "Mountains" || m === "Hills") highland++;
    if (m === "Mountains") mtn++;
  }
  assert.ok(sea >= 49, `expected ~all Sea, got ${sea}/50`);
  // Mostly highland, with the occasional ridge desert / rain-shadow patch.
  assert.ok(highland >= 42, `expected mostly highland, got ${highland}/50`);
  assert.ok(mtn > 25, `expected Mountains to be the plurality, got ${mtn}/50`);
});

test("terrainAt: a Sea neighbour forbids Lake, a Lake neighbour forbids Sea (no coastal lakes)", () => {
  for (let i = 0; i < 200; i++) {
    // any neighbour set that includes Sea must never yield Lake
    assert.notEqual(terrainAt("s", i, 1, ["Sea", "Plains"]), "Lake");
    // ...and one that includes Lake must never yield Sea
    assert.notEqual(terrainAt("s", i, 2, ["Lake", "Plains"]), "Sea");
  }
});

test("area: a Lake is never adjacent to a Sea in a generated map (the forbid holds under fill)", () => {
  let adjacent = 0, lakes = 0, total = 0;
  for (let s = 0; s < 4; s++) {
    const map = generateArea(`area-${s}`, 30);
    total += map.size;
    for (const [k, t] of map) {
      if (t !== "Lake") continue;
      lakes++;
      const [q, r] = k.split(",").map(Number);
      for (const n of neighbors(q, r)) {
        if (map.get(axialKey(n.q, n.r)) === "Sea") { adjacent++; break; }
      }
    }
  }
  assert.ok(total > 0 && lakes > 0, "expected some lakes to check");
  assert.equal(adjacent, 0, `expected no lake adjacent to sea, found ${adjacent}`);
});

test("area: water is a coastal minority, not a flood (Sea spawn dialed down)", () => {
  // Sea used to average ~a third of the map (up to 90% on bad seeds); the spawn
  // rate was cut so water is a coastal minority. Guard the mean/median across a
  // representative seed sweep so a future bump can't silently re-flood the world.
  const fracs = [];
  for (let s = 0; s < 30; s++) {
    const map = generateArea(s, 16);
    let water = 0;
    for (const t of map.values()) if (WATER_TERRAINS.has(t)) water++;
    fracs.push(water / map.size);
  }
  fracs.sort((a, b) => a - b);
  const mean = fracs.reduce((a, b) => a + b, 0) / fracs.length;
  const median = fracs[fracs.length >> 1];
  assert.ok(mean < 0.2, `mean water too high (re-flooded?): ${(100 * mean).toFixed(1)}%`);
  assert.ok(median < 0.15, `median water too high: ${(100 * median).toFixed(1)}%`);
});

test("area: coherent (low lone-hex rate) and every terrain appears", () => {
  const counts = {}; let total = 0, lone = 0;
  for (let s = 0; s < 4; s++) {
    const map = generateArea(`coh-${s}`, 30);
    for (const [k, t] of map) {
      counts[t] = (counts[t] || 0) + 1; total++;
      const [q, r] = k.split(",").map(Number);
      const nts = neighbors(q, r).map((n) => map.get(axialKey(n.q, n.r))).filter(Boolean);
      if (nts.length && !nts.includes(t)) lone++;
    }
  }
  // Clean regions: lone-hex well under the pre-affinity noise baseline (~10-15%).
  assert.ok(lone / total < 0.08, `lone-hex too high: ${(100 * lone / total).toFixed(1)}%`);
  for (const t of TERRAINS) {
    assert.ok((counts[t] || 0) > 0, `terrain ${t} never appeared`);
  }
});
