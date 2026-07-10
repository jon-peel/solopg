import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRegions, regionName } from "../js/gen/regions.js";
import { axialKey } from "../js/core/hexgeo.js";

function terrainMap(entries) { // entries: [q, r, terrain]
  const m = new Map();
  for (const [q, r, t] of entries) m.set(axialKey(q, r), t);
  return m;
}
// Fill a filled axial box with one terrain.
function fillBox(qMin, qMax, rMin, rMax, terrain) {
  const e = [];
  for (let q = qMin; q <= qMax; q++) for (let r = rMin; r <= rMax; r++) e.push([q, r, terrain]);
  return e;
}

test("computeRegions: names a big same-terrain clump, skips small ones", () => {
  const terr = terrainMap([
    ...fillBox(0, 3, 0, 3, "Forest"), // 16-hex forest -> named
    ...fillBox(10, 11, 0, 0, "Swamp"), // 2-hex swamp -> below threshold
  ]);
  const regions = computeRegions("s", terr, { minSize: 8 });
  assert.equal(regions.length, 1, "only the big clump is named");
  assert.equal(regions[0].terrain, "Forest");
  assert.equal(regions[0].size, 16);
  assert.ok(/^(the |Lake )/.test(regions[0].name), `name reads as a place: ${regions[0].name}`);
});

test("computeRegions: separate clumps of the same terrain are distinct regions", () => {
  const terr = terrainMap([
    ...fillBox(0, 3, 0, 2, "Mountains"),   // clump A (12)
    ...fillBox(20, 23, 0, 2, "Mountains"), // clump B (12), far away -> not connected
  ]);
  const regions = computeRegions("s", terr, { minSize: 8 });
  assert.equal(regions.length, 2);
  assert.notEqual(regions[0].anchor, regions[1].anchor);
});

test("computeRegions: centroid sits inside the clump's span", () => {
  const terr = terrainMap(fillBox(0, 4, 0, 4, "Hills"));
  const [reg] = computeRegions("s", terr, { minSize: 8 });
  assert.ok(reg.cq >= 0 && reg.cq <= 4 && reg.cr >= 0 && reg.cr <= 4);
});

test("computeRegions: deterministic — same inputs give the same names", () => {
  const terr = terrainMap(fillBox(0, 4, 0, 4, "Desert"));
  assert.deepEqual(computeRegions("s", terr), computeRegions("s", terr));
});

test("regionName: terrain-flavored and stable per (seed, anchor)", () => {
  const a = regionName("s", "Swamp", axialKey(0, 0));
  assert.equal(a, regionName("s", "Swamp", axialKey(0, 0)), "stable");
  // a swamp name should draw from the marsh/fen family
  let sawMarsh = false;
  for (let i = 0; i < 40; i++) {
    const n = regionName("seed" + i, "Swamp", axialKey(0, 0));
    if (/(Marches|Fens|Mire|Moors|Sloughs)/.test(n)) sawMarsh = true;
  }
  assert.ok(sawMarsh, "swamp regions use wetland nouns");
  // a lake sometimes reads "Lake X"
  let sawLake = false;
  for (let i = 0; i < 40; i++) if (/^Lake /.test(regionName("k" + i, "Lake", axialKey(0, 0)))) sawLake = true;
  assert.ok(sawLake, "lakes sometimes read 'Lake X'");
});
