import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  SCHEMA_VERSION,
  addHex,
  getHex,
  hasHexAt,
  placedHexes,
  removeHex,
  nextUnplacedKey,
} from "../js/world/world.js";
import { axialKey } from "../js/core/hexgeo.js";
import { exportWorld, importWorld } from "../js/data/portability.js";

test("createWorld produces a valid empty world", () => {
  const w = createWorld({ name: "Greyvale", seed: 42 });
  assert.equal(w.schemaVersion, SCHEMA_VERSION);
  assert.equal(w.name, "Greyvale");
  assert.equal(w.seed, 42);
  assert.ok(typeof w.id === "string" && w.id.length > 0);
  assert.deepEqual(w.hexes, {});
  assert.ok(w.createdAt && w.updatedAt);
});

test("createWorld mints a seed when none is given", () => {
  const w = createWorld({ name: "Random" });
  assert.equal(typeof w.seed, "number");
});

test("createWorld applies defaults", () => {
  const w = createWorld();
  assert.equal(w.name, "Untitled World");
  assert.equal(w.hexScale, 6);
});

test("export -> import round-trips losslessly", () => {
  const w = createWorld({ name: "Roundtrip", seed: 7 });
  const restored = importWorld(exportWorld(w));
  assert.deepEqual(restored, w);
});

test("import rejects non-JSON", () => {
  assert.throws(() => importWorld("not json"), /valid JSON/);
});

test("import rejects a missing schemaVersion", () => {
  assert.throws(() => importWorld(JSON.stringify({ id: "x", name: "y" })), /schemaVersion/);
});

test("import rejects a newer schemaVersion", () => {
  const future = exportWorld({
    ...createWorld({ name: "Future", seed: 1 }),
    schemaVersion: SCHEMA_VERSION + 1,
  });
  assert.throws(() => importWorld(future), /newer/);
});

function placedHex(q, r, terrain = "Forest") {
  return {
    key: axialKey(q, r),
    coords: { q, r },
    placed: true,
    terrain,
    terrainFeature: null,
    settlement: { present: false },
    pois: [],
    explored: true,
  };
}

test("getHex retrieves by axial coords; undefined when empty", () => {
  const w = createWorld({ name: "Map", seed: 1 });
  addHex(w, placedHex(2, -1));
  assert.equal(getHex(w, 2, -1).terrain, "Forest");
  assert.equal(getHex(w, 9, 9), undefined);
});

test("hasHexAt is true only for placed hexes", () => {
  const w = createWorld({ name: "Map", seed: 1 });
  addHex(w, placedHex(0, 0));
  // an unplaced hex parked under some coincidental key
  addHex(w, { key: axialKey(1, 1), coords: null, placed: false });
  assert.equal(hasHexAt(w, 0, 0), true);
  assert.equal(hasHexAt(w, 1, 1), false);
  assert.equal(hasHexAt(w, 5, 5), false);
});

test("placedHexes returns only placed hexes with coords", () => {
  const w = createWorld({ name: "Map", seed: 1 });
  addHex(w, placedHex(0, 0));
  addHex(w, placedHex(1, 0));
  addHex(w, { key: "u:0", coords: null, placed: false }); // Phase-1 style
  const placed = placedHexes(w);
  assert.equal(placed.length, 2);
  assert.ok(placed.every((h) => h.placed && h.coords));
});

test("removeHex deletes the keyed hex and leaves others; no-op when missing", () => {
  const w = createWorld({ name: "Map", seed: 1 });
  addHex(w, placedHex(0, 0));
  addHex(w, placedHex(1, 0));
  removeHex(w, 0, 0);
  assert.equal(getHex(w, 0, 0), undefined);
  assert.ok(getHex(w, 1, 0)); // sibling untouched
  // removing a non-existent cell is a no-op
  removeHex(w, 9, 9);
  assert.equal(placedHexes(w).length, 1);
});

test("nextUnplacedKey ignores axial keys", () => {
  const w = createWorld({ name: "Mixed", seed: 1 });
  addHex(w, placedHex(3, 4));
  assert.equal(nextUnplacedKey(w), "u:0");
  addHex(w, { key: "u:0", coords: null, placed: false });
  assert.equal(nextUnplacedKey(w), "u:1");
});
