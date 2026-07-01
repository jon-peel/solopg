import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRadialModel, ringCenter } from "../js/ui/radial-model.js";

const TERRAINS = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert", "Water"];
const POI_TYPES = ["dungeon", "shrine", "camp", "landmark", "tower"];

const base = (over = {}) => ({
  placed: false,
  terrain: null,
  hasSettlement: false,
  allowedSizes: [],
  canGossip: false,
  poiTypes: POI_TYPES,
  terrains: TERRAINS,
  ...over,
});

const byId = (model, id) => model.find((s) => s.id === id);
const SLOTS = ["terrain", "poi", "settlement", "hook", "generate", "regenerate", "deleteHex", "reserved"];

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
  for (const id of ["poi", "settlement", "regenerate", "deleteHex"]) {
    assert.equal(byId(m, id).enabled, false, `${id} should be disabled on an empty cell`);
    assert.ok(byId(m, id).reason, `${id} should carry a reason`);
  }
});

test("placed cell: build actions enabled; Generate stays enabled (Random child gates instead)", () => {
  const m = buildRadialModel(base({ placed: true, terrain: "Forest", allowedSizes: ["Thorp"] }));
  for (const id of ["poi", "settlement", "regenerate", "deleteHex"]) {
    assert.equal(byId(m, id).enabled, true, `${id} should be enabled on a placed cell`);
  }
  // The Generate submenu itself is always open (Area sizes work regardless of
  // whether the center is placed); only its Random (single-hex) child gates.
  assert.equal(byId(m, "generate").enabled, true);
});

test("Reserved slot is always present and disabled, with a reason", () => {
  for (const placed of [false, true]) {
    const r = byId(buildRadialModel(base({ placed, terrain: placed ? "Plains" : null })), "reserved");
    assert.equal(r.enabled, false);
    assert.ok(r.reason);
  }
});

test("Generate submenu: Random (anchored) gates on placed; Small/Medium/Large always fill-empty", () => {
  const empty = byId(buildRadialModel(base()), "generate");
  const emptyRandom = empty.children.find((c) => c.id === "generate");
  assert.equal(emptyRandom.enabled, true);
  assert.equal(emptyRandom.anchor, true);

  const placed = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "generate");
  const placedRandom = placed.children.find((c) => c.id === "generate");
  assert.equal(placedRandom.enabled, false);
  assert.ok(placedRandom.reason);

  const sizes = placed.children.filter((c) => c.id === "genArea");
  assert.equal(sizes.length, 3);
  assert.deepEqual(sizes.map((c) => c.label), ["Small", "Medium", "Large"]);
  assert.deepEqual(sizes.map((c) => c.value), [1, 2, 3]);
  for (const size of sizes) {
    assert.equal(size.kind, "leaf");
    assert.equal(size.enabled, true);
    assert.notEqual(size.danger, true); // no overwrite mode — nothing dangerous here
  }
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

test("POI's dungeon nests a size sub-ring (Random + each size) when sizes are supplied", () => {
  const sizes = [
    { label: "Cramped", value: "Cramped", title: "A den." },
    { label: "Sizable", value: "Sizable", title: "A proper dungeon." },
  ];
  const poi = byId(buildRadialModel(base({ placed: true, terrain: "Forest", dungeonSizes: sizes })), "poi");
  const dungeon = poi.children.find((c) => c.label === "dungeon");
  assert.equal(dungeon.kind, "submenu");
  assert.equal(dungeon.children[0].id, "addRandomDungeon");
  assert.equal(dungeon.children[0].anchor, true);
  const sized = dungeon.children.filter((c) => c.id === "addDungeon");
  assert.deepEqual(sized.map((c) => c.value), ["Cramped", "Sizable"]);
  // Other POI types remain plain leaves.
  assert.equal(poi.children.find((c) => c.label === "shrine").kind, "leaf");
});

test("POI's dungeon stays a leaf (random size) when no sizes are supplied", () => {
  const poi = byId(buildRadialModel(base({ placed: true, terrain: "Forest" })), "poi");
  const dungeon = poi.children.find((c) => c.label === "dungeon");
  assert.equal(dungeon.kind, "leaf");
  assert.equal(dungeon.id, "addPoi");
  assert.equal(dungeon.value, "dungeon");
});

// Regression: the ring must center on the clicked point, translated into the
// host (#stage) box — not collapse to a fixed corner.
const PAD = 200; // OUTER_R(150) + SUB_NODE(50), matching radial-menu.js
const RECT = { left: 100, top: 50, width: 1000, height: 800 };

test("ringCenter centers on the click, relative to the host box", () => {
  // A click well inside the box maps to (clientX-left, clientY-top), unclamped.
  assert.deepEqual(ringCenter(600, 450, RECT, PAD), { x: 500, y: 400 });
});

test("ringCenter tracks the cursor — different clicks give different centers", () => {
  const a = ringCenter(400, 300, RECT, PAD);
  const b = ringCenter(700, 600, RECT, PAD);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, { x: 300, y: 250 });
  assert.deepEqual(b, { x: 600, y: 550 });
});

test("ringCenter clamps near every edge so the ring stays fully on-screen", () => {
  // Top-left corner click → pinned in by PAD on both axes.
  assert.deepEqual(ringCenter(100, 50, RECT, PAD), { x: PAD, y: PAD });
  // Bottom-right corner click → pinned to (width-PAD, height-PAD).
  assert.deepEqual(ringCenter(1100, 850, RECT, PAD), { x: 1000 - PAD, y: 800 - PAD });
});

test("ringCenter falls back to raw client coords for a zero/hidden host box", () => {
  // This is the exact failure mode of the original bug (measured while
  // display:none → zero rect). It must NOT pin to a corner.
  assert.deepEqual(ringCenter(640, 360, { left: 0, top: 0, width: 0, height: 0 }, PAD), { x: 640, y: 360 });
  assert.deepEqual(ringCenter(640, 360, null, PAD), { x: 640, y: 360 });
});
