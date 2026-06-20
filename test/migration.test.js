import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateWorld, importWorld, exportWorld } from "../js/data/portability.js";
import { createWorld, SCHEMA_VERSION } from "../js/world/world.js";

function v2World() {
  return {
    schemaVersion: 2,
    id: "w1",
    name: "Old",
    seed: 5,
    hexScale: 6,
    hexes: {
      "0,0": {
        key: "0,0",
        coords: { q: 0, r: 0 },
        placed: true,
        terrain: "Forest",
        terrainFeature: null,
        settlement: { present: true, size: "Village" },
        pois: { present: true, count: 2 },
        explored: true,
      },
    },
    createdAt: "x",
    updatedAt: "x",
  };
}

// A v3 world whose dungeon POI still carries the Phase-3 placeholder stub.
function v3WorldWithDungeonStub() {
  return {
    schemaVersion: 3,
    id: "w3",
    name: "Mid",
    seed: 7,
    hexScale: 6,
    hexes: {
      "0,0": {
        key: "0,0",
        coords: { q: 0, r: 0 },
        placed: true,
        terrain: "Mountains",
        terrainFeature: null,
        settlement: { present: false },
        pois: [
          { id: "poi:0", type: "dungeon", name: "Dungeon", occupant: { kind: "none" },
            detail: { flavor: "An abandoned dungeon.", stub: { phase: 4 } } },
        ],
        explored: true,
      },
    },
    createdAt: "x",
    updatedAt: "x",
  };
}

test("migrateWorld upgrades v2 -> current: pois become [], terrain/settlement kept", () => {
  const w = migrateWorld(v2World());
  assert.equal(w.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(w.hexes["0,0"].pois, []);
  assert.equal(w.hexes["0,0"].terrain, "Forest");
  assert.deepEqual(w.hexes["0,0"].settlement, { present: true, size: "Village" });
});

test("migrateWorld upgrades v3 -> v4: dungeon stub dropped, interior generated lazily", () => {
  const w = migrateWorld(v3WorldWithDungeonStub());
  assert.equal(w.schemaVersion, 4);
  const poi = w.hexes["0,0"].pois[0];
  assert.equal(poi.detail.stub, undefined);
  assert.equal(poi.detail.dungeon, undefined); // built on first open, not by migration
  assert.equal(poi.detail.flavor, "An abandoned dungeon."); // other detail preserved
});

test("importWorld migrates a v2 JSON up to the current version", () => {
  const restored = importWorld(JSON.stringify(v2World()));
  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(restored.hexes["0,0"].pois, []);
});

test("importWorld still rejects a newer schemaVersion", () => {
  const future = exportWorld({
    ...createWorld({ name: "Future", seed: 1 }),
    schemaVersion: SCHEMA_VERSION + 1,
  });
  assert.throws(() => importWorld(future), /newer/);
});

test("a fresh current-version world is unchanged by migration", () => {
  const w = createWorld({ name: "New", seed: 2 });
  const before = JSON.parse(JSON.stringify(w));
  assert.deepEqual(migrateWorld(w), before);
});
