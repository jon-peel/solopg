import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHex, weightedTerrainTable } from "../js/gen/hex.js";
import { TERRAIN_AFFINITY } from "../js/gen/terrain-affinity.js";

function baseTerrain() {
  return {
    id: "terrain",
    entries: [
      { weight: 4, value: "Forest" },
      { weight: 3, value: "Plains" },
      { weight: 2, value: "Hills" },
      { weight: 1, value: "Water" },
      { weight: 1, value: "Swamp", roll: { table: "swamp-feature" } },
    ],
  };
}

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

const weightOf = (t) => Object.fromEntries(t.entries.map((e) => [e.value, e.weight]));

test("affinity matrix: self is the strongest bonus for each terrain", () => {
  for (const [nbr, row] of Object.entries(TERRAIN_AFFINITY)) {
    const self = row[nbr] ?? 0;
    for (const [cand, bonus] of Object.entries(row)) {
      if (cand !== nbr) assert.ok(self >= bonus, `${nbr}->${cand}`);
    }
  }
});

test("no neighbors -> weights unchanged and roll preserved", () => {
  const t = weightedTerrainTable(baseTerrain(), []);
  assert.deepEqual(weightOf(t), {
    Forest: 4,
    Plains: 3,
    Hills: 2,
    Water: 1,
    Swamp: 1,
  });
  assert.deepEqual(t.entries.find((e) => e.value === "Swamp").roll, {
    table: "swamp-feature",
  });
});

test("a Forest neighbor boosts Forest most, Plains/Hills some, Water not at all", () => {
  const w = weightOf(weightedTerrainTable(baseTerrain(), ["Forest"]));
  // Forest: 4 + 3(self), Plains: 3 + 1, Hills: 2 + 1, Water: unchanged
  assert.equal(w.Forest, 7);
  assert.equal(w.Plains, 4);
  assert.equal(w.Hills, 3);
  assert.equal(w.Water, 1);
});

test("multiplier scales the affinity bonus", () => {
  const w = weightOf(
    weightedTerrainTable(baseTerrain(), ["Forest"], { multiplier: 10 }),
  );
  assert.equal(w.Forest, 4 + 3 * 10);
  assert.equal(w.Plains, 3 + 1 * 10);
});

test("does not mutate the base table", () => {
  const base = baseTerrain();
  const snapshot = JSON.parse(JSON.stringify(base));
  weightedTerrainTable(base, ["Forest", "Mountains"], { multiplier: 5 });
  assert.deepEqual(base, snapshot);
});

test("custom affinity is honored", () => {
  const affinity = { Plains: { Hills: 9 } };
  const w = weightOf(
    weightedTerrainTable(baseTerrain(), ["Plains"], { affinity }),
  );
  assert.equal(w.Hills, 2 + 9);
  assert.equal(w.Plains, 3); // no self entry in custom affinity
});

test("generateHex honors neighborTerrains via affinity", () => {
  const tables = makeTables();
  // base [F4,P3,Hi2,W1,Sw1] total 11; v=0.45 -> target ~4.95 -> Plains (4..7).
  const unbiased = generateHex(tables, makeForced([0.45]), { key: "a" });
  assert.equal(unbiased.terrain, "Plains");
  // strong Forest bias pushes the same draw into the (now huge) Forest band.
  const biased = generateHex(tables, makeForced([0.45]), {
    key: "b",
    neighborTerrains: ["Forest", "Forest"],
    terrainBias: 10,
  });
  assert.equal(biased.terrain, "Forest");
});

test("Swamp nested roll still fires under bias", () => {
  const tables = makeTables();
  const hex = generateHex(tables, makeForced([0.999]), {
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
