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
import { downhillDirection } from "../js/gen/river.js";
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

// Sea contagion (3R.4): a manually-forced Sea hex should make nearby future
// generation more likely to continue the coastline. This mirrors exactly how
// app.js's buildRandomHex computes seaNeighborCount from already-placed
// neighbours — deliberately NOT via the shared generateArea() helper above,
// which always uses seaNeighborCount=0 (the pure, order-independent path the
// other tests in this file assert on; contagion is an intentional, narrowly-
// scoped exception to that, see js/gen/biome.js).
function seaNeighborCountIn(world, q, r) {
  return neighbors(q, r).filter((n) => {
    const h = getHex(world, n.q, n.r);
    return h && h.placed && h.terrain === "Sea";
  }).length;
}

function walkFromForcedSea(seed, startQ, startR, dir, steps) {
  const tables = loadTables();
  const world = createWorld({ name: "contagion-test", seed });
  const startRng = subRng(seed, "hex", startQ, startR, 0);
  const startHex = generateHex(tables, startRng, {
    key: axialKey(startQ, startR), coords: { q: startQ, r: startR }, placed: true,
    terrain: "Sea", seed, gen: 0,
  });
  addHex(world, startHex);
  let q = startQ, r = startR;
  const terrains = [];
  for (let i = 0; i < steps; i++) {
    q += dir.q; r += dir.r;
    const rng = subRng(seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r), coords: { q, r }, placed: true, seed, gen: 0,
      seaNeighborCount: seaNeighborCountIn(world, q, r),
    });
    addHex(world, hex);
    terrains.push(hex.terrain);
  }
  return terrains;
}

test("sea contagion: a manually-placed Sea hex measurably extends the coastline into nearby generation", () => {
  // Across many seeds/directions (all far from the origin's land bias),
  // walking away from a forced Sea hex should continue as Sea for a stretch
  // before land breaks through, on average — not just revert immediately,
  // nor go on forever (the escape hatch must still work).
  let totalSeaSteps = 0;
  let walks = 0;
  let anyLandBreakthrough = false;
  const dirs = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }];
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const dir of dirs) {
      const terrains = walkFromForcedSea(seed, 50, 0, dir, 15);
      const firstLand = terrains.findIndex((t) => t !== "Sea");
      totalSeaSteps += firstLand === -1 ? terrains.length : firstLand;
      if (firstLand !== -1) anyLandBreakthrough = true;
      walks++;
    }
  }
  const meanSeaSteps = totalSeaSteps / walks;
  assert.ok(meanSeaSteps > 1.5, `expected the coastline to extend on average > 1.5 steps, got ${meanSeaSteps.toFixed(2)}`);
  assert.ok(anyLandBreakthrough, "expected at least one walk where land eventually broke through");
});

// Rivers (3R.5): propagated incrementally as hexes are generated, mirroring
// exactly how app.js's buildRandomHex computes incomingRiverEdges from
// already-placed neighbours' riverEdges. Deliberately NOT via the shared
// generateArea() helper above (which always passes incomingRiverEdges=[]) —
// river propagation is history-dependent by design, same rationale as sea
// contagion above.
function incomingRiverEdgesIn(world, q, r) {
  const dirs = [];
  neighbors(q, r).forEach((n, i) => {
    const nh = getHex(world, n.q, n.r);
    if (nh && nh.placed && nh.riverEdges && nh.riverEdges.includes((i + 3) % 6)) {
      dirs.push(i);
    }
  });
  return dirs;
}

function generateAreaWithRivers(seed, radius, coordsInOrder) {
  const tables = loadTables();
  const world = createWorld({ name: "river-test", seed });
  const genIndex = new Map();
  coordsInOrder.forEach((c, i) => genIndex.set(axialKey(c.q, c.r), i));
  for (const { q, r } of coordsInOrder) {
    const rng = subRng(seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r), coords: { q, r }, placed: true, seed, gen: 0,
      incomingRiverEdges: incomingRiverEdgesIn(world, q, r),
    });
    hex.gen = 0;
    addHex(world, hex);
  }
  return { world, genIndex };
}

test("rivers: at least some hexes carry riverEdges across a large generated area", () => {
  const { world } = generateAreaWithRivers(1, 40, hexDisc(0, 0, 40));
  const hexes = placedHexes(world);
  const riverHexCount = hexes.filter((h) => h.riverEdges.length > 0).length;
  assert.ok(riverHexCount > 0, "expected at least one hex with a river edge in a ~5000-hex sample");
});

test("rivers: an edge toward an already-placed neighbour always connects to that neighbour's matching incoming edge", () => {
  // The propagation invariant this whole design rests on: if hex A's edge
  // points at neighbour B, and B was generated AFTER A (so it could see A's
  // edge via incomingRiverEdges at its own generation time), B's riverEdges
  // must include the matching opposite-direction edge. (An edge toward a
  // neighbour generated BEFORE A is a known, accepted gap — see river.js's
  // module comment on incremental, order-dependent propagation.)
  const { world, genIndex } = generateAreaWithRivers(1, 40, hexDisc(0, 0, 40));
  const hexes = placedHexes(world);
  let checked = 0;
  for (const h of hexes) {
    for (const dir of h.riverEdges) {
      const n = neighbors(h.coords.q, h.coords.r)[dir];
      const nh = getHex(world, n.q, n.r);
      if (!nh) continue;
      const myIndex = genIndex.get(axialKey(h.coords.q, h.coords.r));
      const nIndex = genIndex.get(axialKey(n.q, n.r));
      if (nIndex <= myIndex) continue; // the known, accepted gap
      checked++;
      assert.ok(
        nh.riverEdges.includes((dir + 3) % 6),
        `neighbour at (${n.q},${n.r}) should carry the matching incoming edge from (${h.coords.q},${h.coords.r})`,
      );
    }
  }
  assert.ok(checked > 0, "expected at least one edge toward a later-generated neighbour to check");
});

test("rivers: any river hex that isn't a sink (Lake/Sea) always has an outgoing edge toward its own downhill neighbour", () => {
  // Every non-sink hex carrying a river must have routed onward — either it
  // has a real downhill direction included in its edges, or (river.js's
  // riverStateAt) it would have been forced to Lake instead. Since we only
  // look at non-Lake/Sea hexes here, downhillDirection must be valid.
  const { world } = generateAreaWithRivers(2, 40, hexDisc(0, 0, 40));
  const hexes = placedHexes(world);
  let checked = 0;
  for (const h of hexes) {
    if (h.riverEdges.length === 0) continue;
    if (h.terrain === "Lake" || h.terrain === "Sea") continue;
    checked++;
    const outDir = downhillDirection(2, h.coords.q, h.coords.r);
    assert.notEqual(outDir, -1, `hex (${h.coords.q},${h.coords.r}) carries a river but has no valid downhill dir and wasn't forced to Lake`);
    assert.ok(h.riverEdges.includes(outDir), `hex (${h.coords.q},${h.coords.r})'s edges should include its own downhill direction`);
  }
  assert.ok(checked > 0, "expected at least one non-sink river hex to check");
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
