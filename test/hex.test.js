import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateHex } from "../js/gen/hex.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

const FULL_SIZE = {
  id: "settlement-size",
  entries: ["Thorp", "Hamlet", "Village", "Town", "City"].map((size) => ({
    value: { size },
  })),
};

// Tables for the generator: small in-memory terrain/size + the real POI data.
function makeTables(terrain) {
  const t = new Map();
  t.set("terrain", terrain || { id: "terrain", entries: [{ value: "Plains" }] });
  t.set("swamp-feature", { id: "swamp-feature", entries: [{ value: "Bog" }] });
  t.set("settlement-size", FULL_SIZE);
  for (const id of ["poi-types", "poi-occupant", "creatures", "occupiers"]) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

const sameExceptTime = (a, b) => {
  const { createdAt: _a, ...ra } = a;
  const { createdAt: _b, ...rb } = b;
  assert.deepEqual(ra, rb);
};

const forced = (vals) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
};

const opts = (extra) => ({
  key: "0,0",
  coords: { q: 0, r: 0 },
  placed: true,
  seed: 123,
  gen: 0,
  ...extra,
});

test("generateHex is deterministic for a given seed", () => {
  const t = makeTables();
  const a = generateHex(t, mulberry32(123), opts());
  const b = generateHex(t, mulberry32(123), opts());
  sameExceptTime(a, b);
});

test("pois is an array (typed POIs), empty when chance fails", () => {
  const t = makeTables();
  // forced terrain Plains; settlement absent (0.99), POI presence fails (0.99)
  const hex = generateHex(t, forced([0.99, 0.99]), opts({ terrain: "Plains" }));
  assert.ok(Array.isArray(hex.pois));
  assert.equal(hex.pois.length, 0);
});

test("POIs are typed objects when present", () => {
  const t = makeTables();
  // Plains; settlement absent (0.99), POI present (0.0), count 1d2 -> 1
  const hex = generateHex(t, forced([0.99, 0.0, 0.0]), opts({ terrain: "Plains" }));
  assert.ok(hex.pois.length >= 1);
  for (const p of hex.pois) {
    assert.ok(typeof p.type === "string" && typeof p.name === "string");
    assert.ok(p.occupant && typeof p.occupant.kind === "string");
  }
});

test("no settlement in Water", () => {
  const t = makeTables();
  for (let s = 0; s < 50; s++) {
    const hex = generateHex(t, mulberry32(s), opts({ terrain: "Water" }));
    assert.equal(hex.settlement.present, false);
  }
});

test("no City in Desert (size capped at Town)", () => {
  const t = makeTables();
  // forced terrain Desert; settlement present (0.0); size roll; no POIs (0.99)
  const hex = generateHex(t, forced([0.0, 0.0, 0.99]), opts({ terrain: "Desert" }));
  assert.equal(hex.settlement.present, true);
  assert.notEqual(hex.settlement.size, "City");
});

test("Swamp yields a terrain feature when forced (nested roll still resolves)", () => {
  const t = makeTables({
    id: "terrain",
    entries: [{ value: "Swamp", roll: { table: "swamp-feature" } }, { value: "Plains" }],
  });
  // Terrain is no longer rng-rolled (Phase 3R.3 — it's classified from
  // elevation/moisture); force it directly and confirm the nested
  // swamp-feature roll still fires against the chosen entry.
  const hex = generateHex(t, mulberry32(1), opts({ terrain: "Swamp" }));
  assert.equal(hex.terrain, "Swamp");
  assert.equal(hex.terrainFeature, "Bog");
});

test("manual (forced) terrain overrides the classifier; no nested feature outside Swamp", () => {
  const t = makeTables();
  const hex = generateHex(t, mulberry32(7), opts({ terrain: "Mountains" }));
  assert.equal(hex.terrain, "Mountains");
  assert.equal(hex.terrainFeature, null);
});

test("elevation/moisture are always present and in [0,1), classified or forced", () => {
  const t = makeTables();
  const rolled = generateHex(t, mulberry32(1), opts());
  const forced = generateHex(t, mulberry32(1), opts({ terrain: "Mountains" }));
  for (const hex of [rolled, forced]) {
    assert.equal(typeof hex.elevation, "number");
    assert.equal(typeof hex.moisture, "number");
    assert.ok(hex.elevation >= 0 && hex.elevation < 1);
    assert.ok(hex.moisture >= 0 && hex.moisture < 1);
  }
});

test("elevation/moisture are a pure function of (seed, coords) — independent of forced terrain", () => {
  const t = makeTables();
  const rolled = generateHex(t, mulberry32(1), opts());
  const forced = generateHex(t, mulberry32(1), opts({ terrain: "Mountains" }));
  assert.equal(rolled.elevation, forced.elevation);
  assert.equal(rolled.moisture, forced.moisture);
});

test("shipped weighted tables are valid", () => {
  for (const id of ["creatures", "occupiers"]) {
    const table = JSON.parse(readFileSync(`./data/${id}.json`, "utf8"));
    validateTable(table);
    assert.equal(table.id, id);
  }
});
