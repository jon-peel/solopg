import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHex, weightedTerrainTable } from "../js/gen/hex.js";

function baseTerrain() {
  return {
    id: "terrain",
    entries: [
      { weight: 4, value: "Forest" },
      { weight: 3, value: "Plains" },
      { weight: 1, value: "Swamp", roll: { table: "swamp-feature" } },
    ],
  };
}

// Minimal tables for generateHex, with terrain overridable.
function makeTables(terrain = baseTerrain()) {
  return new Map([
    ["terrain", terrain],
    ["swamp-feature", { id: "swamp-feature", entries: [{ value: "Bog" }] }],
    [
      "settlement-presence",
      { id: "settlement-presence", entries: [{ value: { present: false } }] },
    ],
    [
      "settlement-size",
      { id: "settlement-size", entries: [{ value: { size: "Thorp" } }] },
    ],
    [
      "poi-presence",
      { id: "poi-presence", entries: [{ value: { present: false } }] },
    ],
  ]);
}

test("no neighbors -> weights unchanged and roll preserved", () => {
  const t = weightedTerrainTable(baseTerrain(), [], 2);
  assert.deepEqual(
    t.entries.map((e) => [e.value, e.weight]),
    [
      ["Forest", 4],
      ["Plains", 3],
      ["Swamp", 1],
    ],
  );
  assert.deepEqual(t.entries[2].roll, { table: "swamp-feature" });
});

test("bias adds per matching neighbor", () => {
  const t = weightedTerrainTable(baseTerrain(), ["Forest", "Forest", "Plains"], 2);
  const w = Object.fromEntries(t.entries.map((e) => [e.value, e.weight]));
  assert.equal(w.Forest, 4 + 2 * 2);
  assert.equal(w.Plains, 3 + 2);
  assert.equal(w.Swamp, 1);
});

test("does not mutate the base table", () => {
  const base = baseTerrain();
  const snapshot = JSON.parse(JSON.stringify(base));
  weightedTerrainTable(base, ["Forest"], 5);
  assert.deepEqual(base, snapshot);
});

test("bias shifts the roll distribution toward neighbor terrain", () => {
  // Forest and Plains tie at weight 1; heavy Forest bias should dominate.
  const tied = {
    id: "terrain",
    entries: [
      { weight: 1, value: "Forest" },
      { weight: 1, value: "Plains" },
    ],
  };
  const biased = weightedTerrainTable(tied, ["Forest"], 100);
  let forest = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    // sweep rng across [0,1)
    const v = i / N;
    // inline weighted pick using the biased table
    const total = biased.entries.reduce((s, e) => s + e.weight, 0);
    let target = v * total;
    let chosen = biased.entries[biased.entries.length - 1];
    for (const e of biased.entries) {
      target -= e.weight;
      if (target < 0) {
        chosen = e;
        break;
      }
    }
    if (chosen.value === "Forest") forest++;
  }
  assert.ok(forest > N * 0.9, `expected Forest to dominate, got ${forest}/${N}`);
});

test("generateHex honors neighborTerrains", () => {
  const tables = makeTables();
  // Forced rng: first value steers the terrain pick; rest -> 0 (no settlement/poi).
  // With base [Forest4,Plains3,Swamp1] total 8: v=0.5 -> target 4 -> Plains.
  const unbiased = generateHex(tables, makeForced([0.5]), { key: "a" });
  assert.equal(unbiased.terrain, "Plains");
  // With strong Forest bias, the same v lands in the (now huge) Forest band.
  const biased = generateHex(tables, makeForced([0.5]), {
    key: "b",
    neighborTerrains: ["Forest", "Forest"],
    terrainBias: 10,
  });
  assert.equal(biased.terrain, "Forest");
});

test("Swamp nested roll still fires under bias", () => {
  const tables = makeTables();
  // Bias Swamp heavily and force the pick into the Swamp band.
  const hex = generateHex(tables, makeForced([0.99]), {
    key: "c",
    neighborTerrains: ["Swamp", "Swamp", "Swamp"],
    terrainBias: 50,
  });
  assert.equal(hex.terrain, "Swamp");
  assert.equal(hex.terrainFeature, "Bog");
});

// rng stub yielding the given values then 0.
function makeForced(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}
