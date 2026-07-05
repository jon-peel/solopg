import { test } from "node:test";
import assert from "node:assert/strict";
import {
  raiseSize,
  waterBoostTiers,
  settlementWaterContext,
  applyWaterBoosts,
  seedWaterSettlements,
} from "../js/gen/settlement-water.js";
import { axialKey, neighbors } from "../js/core/hexgeo.js";

test("raiseSize: steps up the tier ladder, capped at City", () => {
  assert.equal(raiseSize("Hamlet", 1), "Village");
  assert.equal(raiseSize("Village", 2), "City");
  assert.equal(raiseSize("Town", 1), "City");
  assert.equal(raiseSize("City", 2), "City"); // capped
  assert.equal(raiseSize("Hamlet", 0), "Hamlet"); // no boost
  assert.equal(raiseSize("Nonsense", 1), "Nonsense"); // unknown size untouched
});

test("waterBoostTiers: estuary +2, river/coast +1, dry 0", () => {
  assert.equal(waterBoostTiers({ estuary: true, riverside: true, coast: true }), 2);
  assert.equal(waterBoostTiers({ riverside: true }), 1);
  assert.equal(waterBoostTiers({ coast: true }), 1);
  assert.equal(waterBoostTiers({}), 0);
});

test("settlementWaterContext: detects on-river, beside-river, coast, and estuary", () => {
  const river = new Set([axialKey(0, 0), axialKey(1, 0)]);
  const terr = new Map([[axialKey(2, -1), "Sea"]]); // a sea neighbour of (1,0)
  // on a river hex
  assert.deepEqual(settlementWaterContext(0, 0, river, terr), { riverside: true, coast: false, estuary: false });
  // beside a river (a neighbour of (2,0) is (1,0), on the river) + sea-adjacent -> estuary
  const ctx = settlementWaterContext(1, 0, river, terr);
  assert.ok(ctx.riverside && ctx.coast && ctx.estuary, JSON.stringify(ctx));
  // dry inland hex
  assert.deepEqual(settlementWaterContext(9, 9, river, terr), { riverside: false, coast: false, estuary: false });
});

test("applyWaterBoosts: boosts by water, captures baseSize, is idempotent", () => {
  const hexes = [
    { coords: { q: 0, r: 0 }, terrain: "Plains", settlement: { present: true, size: "Hamlet" } }, // on river
    { coords: { q: 5, r: 0 }, terrain: "Plains", settlement: { present: true, size: "Hamlet" } }, // dry
    { coords: { q: 2, r: 0 }, terrain: "Plains", settlement: { present: true, size: "Village" } }, // estuary (beside river @1,0 + sea @3,-1... set below)
  ];
  const rivers = [{ path: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }];
  const terrainByKey = new Map(hexes.map((h) => [axialKey(h.coords.q, h.coords.r), h.terrain]));
  // add a Sea tile adjacent to (2,0) so it reads as an estuary (river beside + sea)
  terrainByKey.set(axialKey(3, -1), "Sea");

  applyWaterBoosts(hexes, rivers, terrainByKey);
  assert.equal(hexes[0].settlement.size, "Village"); // Hamlet +1 (on river)
  assert.equal(hexes[0].settlement.baseSize, "Hamlet");
  assert.equal(hexes[0].settlement.waterBoost, "river");
  assert.equal(hexes[1].settlement.size, "Hamlet"); // dry, unchanged
  assert.equal(hexes[1].settlement.waterBoost, null);
  assert.equal(hexes[2].settlement.size, "City"); // Village +2 (estuary)
  assert.equal(hexes[2].settlement.waterBoost, "estuary");

  // idempotent: running again yields the same effective sizes (no compounding)
  applyWaterBoosts(hexes, rivers, terrainByKey);
  assert.equal(hexes[0].settlement.size, "Village");
  assert.equal(hexes[2].settlement.size, "City");
});

test("applyWaterBoosts: a settlement that loses its water context reverts to base", () => {
  const hex = { coords: { q: 0, r: 0 }, terrain: "Plains", settlement: { present: true, size: "Hamlet" } };
  const terr = new Map([[axialKey(0, 0), "Plains"]]);
  applyWaterBoosts([hex], [{ path: [{ q: 0, r: 0 }] }], terr); // on a river -> Village
  assert.equal(hex.settlement.size, "Village");
  applyWaterBoosts([hex], [], terr); // no rivers now -> back to base Hamlet
  assert.equal(hex.settlement.size, "Hamlet");
  assert.equal(hex.settlement.waterBoost, null);
});

// --- seedWaterSettlements: generate NEW settlements at water ----------------

test("seedWaterSettlements: a river mouth on the sea seeds a City/Town (double whammy)", () => {
  const hexByKey = new Map([
    [axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains" }], // land tail = mouth
    [axialKey(1, 0), { coords: { q: 1, r: 0 }, terrain: "Sea" }],
  ]);
  const terr = new Map([[axialKey(0, 0), "Plains"], [axialKey(1, 0), "Sea"]]);
  const rivers = [{ path: [{ q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }] }];
  seedWaterSettlements(hexByKey, rivers, terr, "s");
  const mouth = hexByKey.get(axialKey(0, 0));
  assert.ok(mouth.settlement && mouth.settlement.present, "mouth should be settled");
  assert.ok(["City", "Town"].includes(mouth.settlement.size), `mouth size ${mouth.settlement.size}`);
  assert.ok(mouth.waterSeeded);
});

test("seedWaterSettlements: a big lake earns a shore City", () => {
  const hexByKey = new Map();
  const terr = new Map();
  for (let q = 0; q < 4; q++) for (let r = 0; r < 4; r++) { // 16-hex lake (>= BIG_LAKE_SIZE)
    hexByKey.set(axialKey(q, r), { coords: { q, r }, terrain: "Lake" });
    terr.set(axialKey(q, r), "Lake");
  }
  hexByKey.set(axialKey(-1, 0), { coords: { q: -1, r: 0 }, terrain: "Plains" }); // its only land shore
  terr.set(axialKey(-1, 0), "Plains");
  seedWaterSettlements(hexByKey, [], terr, "s");
  const shore = hexByKey.get(axialKey(-1, 0));
  assert.ok(shore.settlement && shore.settlement.present && shore.settlement.size === "City", "big lake -> shore City");
});

test("seedWaterSettlements: scatters small settlements along a river's course", () => {
  const hexByKey = new Map();
  const terr = new Map();
  const path = [];
  for (let q = 0; q < 100; q++) { // a long dry river (no water sink -> all mid-course)
    hexByKey.set(axialKey(q, 0), { coords: { q, r: 0 }, terrain: "Plains" });
    terr.set(axialKey(q, 0), "Plains");
    path.push({ q, r: 0 });
  }
  seedWaterSettlements(hexByKey, [{ path }], terr, "s");
  const settled = [...hexByKey.values()].filter((h) => h.settlement && h.settlement.present);
  assert.ok(settled.length > 0 && settled.length < 100, `expected some scattered settlements, got ${settled.length}`);
  for (const h of settled) assert.ok(["Hamlet", "Village"].includes(h.settlement.size), `course size ${h.settlement.size}`);
});

test("seedWaterSettlements: idempotent, and a deleted seed is not resurrected", () => {
  const make = () => new Map([
    [axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains" }],
    [axialKey(1, 0), { coords: { q: 1, r: 0 }, terrain: "Sea" }],
  ]);
  const terr = new Map([[axialKey(0, 0), "Plains"], [axialKey(1, 0), "Sea"]]);
  const rivers = [{ path: [{ q: -1, r: 0 }, { q: 0, r: 0 }] }];
  const hbk = make();
  seedWaterSettlements(hbk, rivers, terr, "s");
  const first = hbk.get(axialKey(0, 0)).settlement.size;
  seedWaterSettlements(hbk, rivers, terr, "s"); // re-run: unchanged
  assert.equal(hbk.get(axialKey(0, 0)).settlement.size, first);
  // GM deletes it -> re-run must not resurrect (decided-flag)
  hbk.get(axialKey(0, 0)).settlement = { present: false };
  seedWaterSettlements(hbk, rivers, terr, "s");
  assert.equal(hbk.get(axialKey(0, 0)).settlement.present, false, "deleted seed stays deleted");
});
