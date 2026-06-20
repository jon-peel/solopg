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

test("migrateWorld upgrades v2 -> v3: pois become [], terrain/settlement kept", () => {
  const w = migrateWorld(v2World());
  assert.equal(w.schemaVersion, 3);
  assert.deepEqual(w.hexes["0,0"].pois, []);
  assert.equal(w.hexes["0,0"].terrain, "Forest");
  assert.deepEqual(w.hexes["0,0"].settlement, { present: true, size: "Village" });
});

test("importWorld migrates a v2 JSON to v3", () => {
  const restored = importWorld(JSON.stringify(v2World()));
  assert.equal(restored.schemaVersion, 3);
  assert.deepEqual(restored.hexes["0,0"].pois, []);
});

test("importWorld still rejects a newer schemaVersion", () => {
  const future = exportWorld({
    ...createWorld({ name: "Future", seed: 1 }),
    schemaVersion: SCHEMA_VERSION + 1,
  });
  assert.throws(() => importWorld(future), /newer/);
});

test("a fresh v3 world is unchanged by migration", () => {
  const w = createWorld({ name: "New", seed: 2 });
  const before = JSON.parse(JSON.stringify(w));
  assert.deepEqual(migrateWorld(w), before);
});
