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

test("migrateWorld upgrades v3 -> current: dungeon stub dropped, interior lazy", () => {
  const w = migrateWorld(v3WorldWithDungeonStub());
  assert.equal(w.schemaVersion, SCHEMA_VERSION);
  const poi = w.hexes["0,0"].pois[0];
  assert.equal(poi.detail.stub, undefined);
  assert.equal(poi.detail.dungeon, undefined); // built on first open, not by migration
  assert.equal(poi.detail.flavor, "An abandoned dungeon."); // other detail preserved
});

// A v4 world with the now-merged explorable POI types (ruin/cave/mine).
function v4WorldWithExplorables() {
  const poi = (n, type) => ({
    id: `poi:${n}`,
    type,
    name: type[0].toUpperCase() + type.slice(1),
    occupant: { kind: "none" },
    detail: { flavor: "Long abandoned.", dungeon: { size: "Cramped", levels: [] } },
  });
  return {
    schemaVersion: 4,
    id: "w4",
    name: "Merge",
    seed: 9,
    hexScale: 6,
    hexes: {
      "0,0": {
        key: "0,0", coords: { q: 0, r: 0 }, placed: true, terrain: "Hills",
        terrainFeature: null, settlement: { present: false },
        pois: [poi(0, "ruin"), poi(1, "cave"), poi(2, "mine"), poi(3, "shrine")],
        explored: true,
      },
    },
    createdAt: "x",
    updatedAt: "x",
  };
}

test("migrateWorld upgrades v4 -> v5: ruin/cave/mine become themed dungeons", () => {
  const w = migrateWorld(v4WorldWithExplorables());
  assert.equal(w.schemaVersion, 5);
  const pois = w.hexes["0,0"].pois;
  assert.deepEqual(
    pois.map((p) => p.type),
    ["dungeon", "dungeon", "dungeon", "shrine"], // shrine untouched
  );
  assert.equal(pois[0].detail.theme, "Ruin");
  assert.equal(pois[1].detail.theme, "Cave complex");
  assert.equal(pois[2].detail.theme, "Abandoned mine");
  // Stale interiors cleared so the themed dungeon regenerates on next open.
  assert.equal(pois[0].detail.dungeon, undefined);
  assert.equal(pois[3].detail.theme, undefined); // shrine gets no theme
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
