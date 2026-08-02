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
const SLOTS = ["terrain", "poi", "settlement", "hook", "generate", "regenerate", "deleteHex", "draw", "party", "faction"];

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

test("Settlement submenu offers a Monastery placement (Random + each allowed size)", () => {
  const sizes = ["Hamlet", "Village", "Town", "City"];
  const settle = byId(buildRadialModel(base({ placed: true, terrain: "Plains", allowedSizes: sizes })), "settlement");
  const mon = settle.children.find((c) => c.id === "addMonasteryMenu");
  assert.ok(mon && mon.kind === "submenu", "a Monastery submenu is present");
  assert.deepEqual(
    mon.children.map((c) => c.id),
    ["addRandomMonastery", "addMonastery", "addMonastery", "addMonastery", "addMonastery"],
  );
  assert.deepEqual(mon.children.slice(1).map((c) => c.value), sizes); // underlying size rides in value
  // …but the labels read as monastic RANKS, not the plain settlement tiers.
  assert.deepEqual(mon.children.slice(1).map((c) => c.label), ["Hermitage", "Priory", "Abbey", "Great Abbey"]);
  // Offered even when a settlement already exists (convert it to a monastery).
  const settle2 = byId(buildRadialModel(base({ placed: true, terrain: "Plains", allowedSizes: sizes, hasSettlement: true })), "settlement");
  assert.ok(settle2.children.some((c) => c.id === "addMonasteryMenu"), "Monastery offered even when a settlement exists");
});

test("Draw slot: offers River + Road; Remove entries only where a manual one runs", () => {
  const plain = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "draw");
  assert.equal(plain.kind, "submenu");
  assert.deepEqual(plain.children.map((c) => c.id), ["drawRiver", "drawRoad"]); // just the two Draw actions
  const withBoth = byId(buildRadialModel(base({ placed: true, terrain: "Plains", manualRiverHere: "manual:0", manualRoadHere: "manual:1" })), "draw");
  assert.deepEqual(withBoth.children.map((c) => c.id), ["drawRiver", "drawRoad", "removeRiver", "removeRoad"]);
  assert.equal(withBoth.children.find((c) => c.id === "removeRiver").value, "manual:0");
  assert.equal(withBoth.children.find((c) => c.id === "removeRoad").value, "manual:1");
});

test("Regenerate slot: Lock/Unlock + This hex + area sizes; lock protects re-roll & delete", () => {
  const reg = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "regenerate");
  assert.equal(reg.kind, "submenu");
  assert.deepEqual(reg.children.map((c) => c.id), ["toggleLock", "regenHex", "regenArea", "regenArea", "regenArea"]);
  assert.equal(reg.children[0].label, "Lock");
  assert.equal(reg.children[2].value, 1); // Small
  assert.equal(byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "deleteHex").enabled, true);
  // Locked: the toggle reads Unlock, This-hex regen is off, Delete is off.
  const locked = buildRadialModel(base({ placed: true, terrain: "Plains", locked: true }));
  const lreg = byId(locked, "regenerate");
  assert.equal(lreg.children[0].label, "Unlock");
  assert.equal(lreg.children.find((c) => c.id === "regenHex").enabled, false);
  assert.equal(byId(locked, "deleteHex").enabled, false, "a locked hex can't be deleted");
});

test("Generate submenu: Random (anchored) gates on placed; Small/Medium/Large/Huge always fill-empty", () => {
  const empty = byId(buildRadialModel(base()), "generate");
  const emptyRandom = empty.children.find((c) => c.id === "generate");
  assert.equal(emptyRandom.enabled, true);
  assert.equal(emptyRandom.anchor, true);

  const placed = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "generate");
  const placedRandom = placed.children.find((c) => c.id === "generate");
  assert.equal(placedRandom.enabled, false);
  assert.ok(placedRandom.reason);

  const sizes = placed.children.filter((c) => c.id === "genArea");
  assert.equal(sizes.length, 4);
  assert.deepEqual(sizes.map((c) => c.label), ["Small", "Medium", "Large", "Huge"]);
  assert.deepEqual(sizes.map((c) => c.value), [1, 2, 3, 15]);
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

test("Terrain submenu is the explicit-pick list only — no Random (Generate already covers that)", () => {
  const m = buildRadialModel(base({ placed: true, terrain: "Forest" }));
  const terrainChildren = byId(m, "terrain").children;
  assert.equal(terrainChildren.length, TERRAINS.length);
  assert.ok(!terrainChildren.some((c) => c.anchor), "Terrain should have no anchored Random child");
  assert.ok(terrainChildren.every((c) => c.id === "placeTerrain"));
});

test("POI submenu anchors its Random child for nearest-cursor placement", () => {
  const m = buildRadialModel(base({ placed: true, terrain: "Forest" }));
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

test("Party submenu: Travel/Place need a placed hex; disabled once the party is here", () => {
  const empty = byId(buildRadialModel(base()), "party");
  assert.deepEqual(empty.children.map((c) => c.id), ["travelToward", "placeParty"]);
  assert.ok(empty.children.every((c) => c.enabled === false)); // no placed hex yet
  const placed = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "party");
  assert.ok(placed.children.every((c) => c.enabled === true));
  const here = byId(buildRadialModel(base({ placed: true, terrain: "Plains", partyHere: true })), "party");
  assert.deepEqual(here.children.map((c) => c.id), ["partyHere"]);
  assert.equal(here.children[0].enabled, false);
});

test("Faction submenu: Generate always present; Run by lists None + factions with a ✓ on the owner", () => {
  const plain = byId(buildRadialModel(base({ placed: true, terrain: "Plains" })), "faction");
  assert.equal(plain.children[0].id, "genFaction");
  assert.ok(!plain.children.some((c) => c.id === "runBy"), "no Run by without factions");

  const factions = [{ id: "faction:0", name: "The Grey Blade", color: "#2a6693" }, { id: "faction:1", name: "Ashen Covenant", color: "#b3641c" }];
  const owned = byId(buildRadialModel(base({ placed: true, terrain: "Plains", factions, ownerId: "faction:1" })), "faction");
  const runBy = owned.children.find((c) => c.id === "runBy");
  assert.equal(runBy.kind, "submenu");
  assert.deepEqual(runBy.children.map((c) => c.id), ["setOwner", "setOwner", "setOwner"]);
  assert.equal(runBy.children[0].value, null); // None
  assert.match(runBy.children.find((c) => c.value === "faction:1").label, /^✓ /); // owner ticked
  assert.equal(runBy.children.find((c) => c.value === "faction:0").label, "The Grey Blade");
  assert.equal(runBy.children.find((c) => c.value === "faction:0").swatch, "#2a6693"); // colour chip
  assert.equal(runBy.children[0].swatch, undefined); // None has no colour
});

test("Faction submenu: reseat + promote (with lord options nesting a sub-ring)", () => {
  const canReseat = { id: "faction:0", name: "The Grey Blade" };
  const promotable = [{ poiId: "poi:2", name: "Old Keep", lords: [{ archetype: "lich", label: "Raise a lich" }] }];
  const fac = byId(buildRadialModel(base({ placed: true, terrain: "Hills", canReseat, promotable })), "faction");
  const reseat = fac.children.find((c) => c.id === "reseat");
  assert.equal(reseat.value, "faction:0");
  const promo = fac.children.find((c) => c.id === "promoteMenu");
  assert.equal(promo.kind, "submenu");
  assert.equal(promo.children[0].value.poiId, "poi:2"); // Ordinary faction
  assert.deepEqual(promo.children[1].value, { poiId: "poi:2", archetype: "lich" }); // lord variant
  // A promotable POI with no lord options is a plain Promote leaf.
  const plain = byId(buildRadialModel(base({ placed: true, terrain: "Plains", promotable: [{ poiId: "poi:3", name: "Camp", lords: [] }] })), "faction");
  const leafPromo = plain.children.find((c) => c.id === "promote");
  assert.equal(leafPromo.kind, "leaf");
  assert.deepEqual(leafPromo.value, { poiId: "poi:3" });
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
