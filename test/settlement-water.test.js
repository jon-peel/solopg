import { test } from "node:test";
import assert from "node:assert/strict";
import {
  raiseSize,
  waterBoostTiers,
  settlementWaterContext,
  applyWaterBoosts,
  seedWaterSettlements,
  seedHamletClusters,
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

test("seedWaterSettlements: a river mouth settles the last LAND hex, never the water sink", () => {
  // computeRivers ENDS the path on the water sink hex, so the mouth is the last land hex.
  // Mouth settlement is probabilistic and its type random, so sweep seeds: the sink must
  // NEVER be settled, and any settlement that appears must be on the land mouth (0,0).
  let sawMouth = false;
  for (let i = 0; i < 40; i++) {
    const hexByKey = new Map([
      [axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains" }], // last LAND hex = mouth
      [axialKey(1, 0), { coords: { q: 1, r: 0 }, terrain: "Sea" }],    // the water sink
    ]);
    const terr = new Map([[axialKey(0, 0), "Plains"], [axialKey(1, 0), "Sea"]]);
    const rivers = [{ path: [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }] }];
    seedWaterSettlements(hexByKey, rivers, terr, "seed" + i);
    const sink = hexByKey.get(axialKey(1, 0));
    assert.ok(!sink.settlement || !sink.settlement.present, "the water sink must never be settled");
    const mouth = hexByKey.get(axialKey(0, 0));
    if (mouth.settlement && mouth.settlement.present) {
      sawMouth = true;
      // Base (pre-boost) type is random; applyWaterBoosts lifts it at the estuary.
      assert.ok(["City", "Town", "Hamlet"].includes(mouth.settlement.size), `mouth size ${mouth.settlement.size}`);
    }
  }
  assert.ok(sawMouth, "across seeds, the land mouth should sometimes be settled");
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
  // A big lake always earns a shore City (deterministic), so use it — mouth settling is
  // now probabilistic and can't anchor a deterministic idempotency check.
  const shoreKey = axialKey(-1, 0);
  const make = () => {
    const m = new Map();
    for (let q = 0; q < 4; q++) for (let r = 0; r < 4; r++) m.set(axialKey(q, r), { coords: { q, r }, terrain: "Lake" });
    m.set(shoreKey, { coords: { q: -1, r: 0 }, terrain: "Plains" }); // its only land shore
    return m;
  };
  const terr = new Map();
  for (let q = 0; q < 4; q++) for (let r = 0; r < 4; r++) terr.set(axialKey(q, r), "Lake");
  terr.set(shoreKey, "Plains");
  const hbk = make();
  seedWaterSettlements(hbk, [], terr, "s");
  const first = hbk.get(shoreKey).settlement.size;
  assert.equal(first, "City");
  seedWaterSettlements(hbk, [], terr, "s"); // re-run: unchanged
  assert.equal(hbk.get(shoreKey).settlement.size, first);
  // GM deletes it -> re-run must not resurrect (decided-flag)
  hbk.get(shoreKey).settlement = { present: false };
  seedWaterSettlements(hbk, [], terr, "s");
  assert.equal(hbk.get(shoreKey).settlement.present, false, "deleted seed stays deleted");
});

// --- seedHamletClusters: a sprinkling of farming hamlets around big towns ----

test("seedHamletClusters: sprinkles Hamlets on farmland around a large settlement", () => {
  const nbs = neighbors(0, 0);
  const settledNb = nbs[1]; // a farmland neighbour that already has a Village
  const build = () => {
    const m = new Map([[axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains", settlement: { present: true, size: "City" } }]]);
    nbs.forEach((nb, i) => {
      const terrain = i === 0 ? "Mountains" : "Plains"; // nbs[0] non-farmland: never a hamlet
      const hex = { coords: { q: nb.q, r: nb.r }, terrain };
      if (i === 1) hex.settlement = { present: true, size: "Village" };
      m.set(axialKey(nb.q, nb.r), hex);
    });
    return m;
  };

  let placed = 0;
  for (let s = 0; s < 60; s++) {
    const m = build();
    seedHamletClusters(m, "seed" + s);
    const mtn = m.get(axialKey(nbs[0].q, nbs[0].r));
    assert.ok(!mtn.settlement || !mtn.settlement.present, "non-farmland neighbour stays wild");
    assert.equal(m.get(axialKey(settledNb.q, settledNb.r)).settlement.size, "Village", "existing settlement not overridden");
    assert.equal(m.get(axialKey(0, 0)).settlement.size, "City", "anchor unchanged");
    for (let i = 2; i < nbs.length; i++) {
      const h = m.get(axialKey(nbs[i].q, nbs[i].r));
      if (h.settlement && h.settlement.present) { assert.equal(h.settlement.size, "Hamlet"); placed++; }
    }
  }
  assert.ok(placed > 0, "across seeds, some farmland neighbours become Hamlets");
});

test("seedHamletClusters: only large (Town/City) settlements anchor a cluster", () => {
  const m = new Map([[axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains", settlement: { present: true, size: "Village" } }]]);
  for (const nb of neighbors(0, 0)) m.set(axialKey(nb.q, nb.r), { coords: { q: nb.q, r: nb.r }, terrain: "Plains" });
  for (let s = 0; s < 40; s++) seedHamletClusters(m, "x" + s);
  const clustered = [...m.values()].filter((h) => !(h.coords.q === 0 && h.coords.r === 0) && h.settlement && h.settlement.present);
  assert.equal(clustered.length, 0, "a Village anchors no farming hamlets");
});

test("seedHamletClusters: idempotent, and a deleted hamlet is not resurrected", () => {
  const build = () => {
    const m = new Map([[axialKey(0, 0), { coords: { q: 0, r: 0 }, terrain: "Plains", settlement: { present: true, size: "City" } }]]);
    for (const nb of neighbors(0, 0)) m.set(axialKey(nb.q, nb.r), { coords: { q: nb.q, r: nb.r }, terrain: "Plains" });
    return m;
  };
  // Find a seed that actually sprinkles a hamlet (chance is low, so sweep).
  let seed = null, m = null, placedKey = null;
  for (let s = 0; s < 300 && !seed; s++) {
    const cand = build();
    seedHamletClusters(cand, "id" + s);
    for (const nb of neighbors(0, 0)) {
      const h = cand.get(axialKey(nb.q, nb.r));
      if (h.settlement && h.settlement.present) { seed = "id" + s; m = cand; placedKey = axialKey(nb.q, nb.r); break; }
    }
  }
  assert.ok(seed, "found a seed that sprinkles a hamlet");
  const count = () => [...m.values()].filter((h) => h.settlement && h.settlement.present).length;
  const before = count();
  seedHamletClusters(m, seed); // re-run: unchanged
  assert.equal(count(), before, "re-run adds no new hamlets");
  // GM deletes a hamlet -> re-run must not resurrect (decided-flag)
  m.get(placedKey).settlement = { present: false };
  seedHamletClusters(m, seed);
  assert.equal(m.get(placedKey).settlement.present, false, "deleted hamlet stays deleted");
});
