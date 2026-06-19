import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateHex } from "../js/gen/hex.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32, subRng } from "../js/core/rng.js";

// In-memory tables (no fetch) so the generator is exercised purely.
function makeTables(overrides = {}) {
  const tables = new Map([
    [
      "terrain",
      {
        id: "terrain",
        entries: [
          { weight: 1, value: "Forest" },
          { weight: 1, value: "Swamp", roll: { table: "swamp-feature" } },
        ],
      },
    ],
    ["swamp-feature", { id: "swamp-feature", entries: [{ value: "Bog" }] }],
    [
      "settlement-presence",
      {
        id: "settlement-presence",
        entries: [
          { weight: 1, value: { present: false } },
          { weight: 1, value: { present: true } },
        ],
      },
    ],
    [
      "settlement-size",
      { id: "settlement-size", entries: [{ value: { size: "Village" } }] },
    ],
    [
      "poi-presence",
      {
        id: "poi-presence",
        entries: [
          { weight: 1, value: { present: false } },
          { weight: 1, value: { present: true, count: "1d2" } },
        ],
      },
    ],
  ]);
  for (const [k, v] of Object.entries(overrides)) tables.set(k, v);
  return tables;
}

// Compare two hexes ignoring the generation timestamp.
function sameExceptTime(a, b) {
  const { createdAt: _a, ...ra } = a;
  const { createdAt: _b, ...rb } = b;
  assert.deepEqual(ra, rb);
}

test("generateHex is deterministic for a given seed", () => {
  const tables = makeTables();
  const a = generateHex(tables, mulberry32(123), { key: "u:0" });
  const b = generateHex(tables, mulberry32(123), { key: "u:0" });
  sameExceptTime(a, b);
});

test("subRng makes a hex reproducible per key and order-independent", () => {
  const tables = makeTables();
  const a = generateHex(tables, subRng("w", "hex", "u:5"), { key: "u:5" });
  // Generate an unrelated hex in between; must not affect u:5.
  generateHex(tables, subRng("w", "hex", "u:9"), { key: "u:9" });
  const again = generateHex(tables, subRng("w", "hex", "u:5"), { key: "u:5" });
  sameExceptTime(a, again);
});

test("settlement size only present when a settlement exists", () => {
  const tables = makeTables();

  // Force settlement-presence -> present:false (first entry, low rng).
  const noSettle = makeForcedRng([0.9, 0.0, 0.0]); // terrain, settlement, poi
  const h1 = generateHex(tables, noSettle.rng, { key: "a" });
  assert.deepEqual(h1.settlement, { present: false });

  // Force settlement-presence -> present:true (second entry, high rng).
  const yesSettle = makeForcedRng([0.0, 0.9, 0.0]);
  const h2 = generateHex(tables, yesSettle.rng, { key: "b" });
  assert.equal(h2.settlement.present, true);
  assert.equal(h2.settlement.size, "Village");
});

test("POI count is 0 when absent and in-range when present", () => {
  const tables = makeTables();

  const noPoi = makeForcedRng([0.0, 0.0, 0.0]); // poi -> present:false
  const h1 = generateHex(tables, noPoi.rng, { key: "a" });
  assert.deepEqual(h1.pois, { present: false, count: 0 });

  const yesPoi = makeForcedRng([0.0, 0.0, 0.9, 0.0]); // poi -> present:true, 1d2
  const h2 = generateHex(tables, yesPoi.rng, { key: "b" });
  assert.equal(h2.pois.present, true);
  assert.ok(h2.pois.count >= 1 && h2.pois.count <= 2);
});

test("Swamp yields a terrain feature; other terrain does not", () => {
  const tables = makeTables();

  const swamp = makeForcedRng([0.9, 0.0, 0.0]); // terrain second entry = Swamp
  const h1 = generateHex(tables, swamp.rng, { key: "a" });
  assert.equal(h1.terrain, "Swamp");
  assert.equal(h1.terrainFeature, "Bog");

  const forest = makeForcedRng([0.0, 0.0, 0.0]); // terrain first entry = Forest
  const h2 = generateHex(tables, forest.rng, { key: "b" });
  assert.equal(h2.terrain, "Forest");
  assert.equal(h2.terrainFeature, null);
});

test("shipped hex tables are valid", () => {
  for (const id of ["settlement-presence", "settlement-size", "poi-presence"]) {
    const table = JSON.parse(readFileSync(`./data/${id}.json`, "utf8"));
    validateTable(table);
    assert.equal(table.id, id);
  }
});

// Returns an rng that yields the given values in order, then 0 thereafter.
// Lets each rollTable/rollDice step be steered to a specific entry.
function makeForcedRng(values) {
  let i = 0;
  return { rng: () => (i < values.length ? values[i++] : 0) };
}
