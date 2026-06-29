import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRadialModel } from "../js/ui/radial-model.js";

const TERRAINS = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert", "Water"];
const POI_TYPES = ["dungeon", "shrine", "camp", "landmark", "tower"];

const base = (over = {}) => ({
  placed: false,
  terrain: null,
  hasSettlement: false,
  allowedSizes: [],
  canGossip: false,
  emptyNeighbors: 0,
  poiTypes: POI_TYPES,
  terrains: TERRAINS,
  ...over,
});

const byId = (model, id) => model.find((s) => s.id === id);
const SLOTS = ["terrain", "poi", "settlement", "hook", "neighbors", "regenerate", "deleteHex", "generate"];

test("slots are a fixed set in a fixed order, regardless of cell state", () => {
  const empty = buildRadialModel(base()).map((s) => s.id);
  const placed = buildRadialModel(base({ placed: true, terrain: "Forest" })).map((s) => s.id);
  assert.deepEqual(empty, SLOTS);
  assert.deepEqual(placed, SLOTS);
});

test("empty cell: Generate + Terrain + Hook enabled; build actions disabled with reasons", () => {
  const m = buildRadialModel(base());
  assert.equal(byId(m, "generate").enabled, true);
  assert.equal(byId(m, "terrain").enabled, true);
  assert.equal(byId(m, "hook").enabled, true);
  for (const id of ["poi", "settlement", "neighbors", "regenerate", "deleteHex"]) {
    assert.equal(byId(m, id).enabled, false, `${id} should be disabled on an empty cell`);
    assert.ok(byId(m, id).reason, `${id} should carry a reason`);
  }
});

test("placed cell: build actions enabled; Generate disabled (use Regenerate)", () => {
  const m = buildRadialModel(base({ placed: true, terrain: "Forest", allowedSizes: ["Thorp"], emptyNeighbors: 2 }));
  for (const id of ["poi", "settlement", "neighbors", "regenerate", "deleteHex"]) {
    assert.equal(byId(m, id).enabled, true, `${id} should be enabled on a placed cell`);
  }
  assert.equal(byId(m, "generate").enabled, false);
  assert.ok(byId(m, "generate").reason);
});

test("Neighbours disabled (with reason) when the hex is fully surrounded", () => {
  const surrounded = byId(buildRadialModel(base({ placed: true, terrain: "Plains", emptyNeighbors: 0 })), "neighbors");
  assert.equal(surrounded.enabled, false);
  assert.match(surrounded.reason, /already filled/i);
  const open = byId(buildRadialModel(base({ placed: true, terrain: "Plains", emptyNeighbors: 1 })), "neighbors");
  assert.equal(open.enabled, true);
});

test("Settlement disabled where the terrain allows none (e.g. open water)", () => {
  const water = byId(buildRadialModel(base({ placed: true, terrain: "Water", allowedSizes: [] })), "settlement");
  assert.equal(water.enabled, false);
  assert.match(water.reason, /Water/);
  // …but enabled if one is already present (so it can be removed).
  const present = byId(buildRadialModel(base({ placed: true, terrain: "Water", allowedSizes: [], hasSettlement: true })), "settlement");
  assert.equal(present.enabled, true);
});

test("Settlement submenu offers Remove when one exists, Random otherwise", () => {
  const none = byId(buildRadialModel(base({ placed: true, terrain: "Plains", allowedSizes: ["Thorp", "Hamlet"] })), "settlement");
  assert.equal(none.children[0].id, "addRandomSettlement");
  assert.equal(none.children[0].anchor, true);
  const present = byId(buildRadialModel(base({ placed: true, terrain: "Plains", allowedSizes: ["Thorp", "Hamlet"], hasSettlement: true })), "settlement");
  assert.equal(present.children[0].id, "removeSettlement");
});

test("Hook submenu always present; gossip gates on a settlement", () => {
  const dry = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "hook");
  assert.equal(dry.enabled, true);
  assert.equal(dry.children.find((c) => c.id === "genHook").enabled, false);
  const town = byId(buildRadialModel(base({ placed: true, terrain: "Plains", canGossip: true })), "hook");
  assert.equal(town.children.find((c) => c.id === "genHook").enabled, true);
});

test("Terrain and POI submenus anchor their Random child for nearest-cursor placement", () => {
  const m = buildRadialModel(base({ placed: true, terrain: "Forest" }));
  const terrainRandom = byId(m, "terrain").children.find((c) => c.anchor);
  assert.equal(terrainRandom.id, "generate");
  assert.equal(byId(m, "terrain").children.length, 1 + TERRAINS.length);
  const poiRandom = byId(m, "poi").children.find((c) => c.anchor);
  assert.equal(poiRandom.id, "addRandomPoi");
});
