import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateHex } from "../js/gen/hex.js";
import { mulberry32 } from "../js/core/rng.js";
import { TERRAIN_PROFILE, isLargeSize } from "../js/gen/terrain-profile.js";

// 3R.6 (Settlements v2, steps A+B): auto-generation settlement chances were
// dialed down to "very sparse" (~1/12 of the pre-3R.6 rates) so settlements read
// as genuine landmarks and the map stays open for the later river-town step.
// These tests pin the very-sparse band (so the old rates can't creep back),
// preserve the habitability ordering, and tie the constants to real generateHex
// output. (Big-settlement rarity + soft clustering suppression are covered in
// terrain-profile.test.js and the suppression test below.)

const LAND = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert"];

test("every land settlement chance is very sparse (<= 0.03; Plains <= 0.022; Desert <= 0.008)", () => {
  for (const t of LAND) {
    const c = TERRAIN_PROFILE[t].settlement.chance;
    assert.ok(c > 0 && c <= 0.03, `${t} chance ${c} outside the very-sparse band`);
  }
  assert.ok(TERRAIN_PROFILE.Plains.settlement.chance <= 0.022);
  assert.ok(TERRAIN_PROFILE.Desert.settlement.chance <= 0.008, "Desert is oasis-only (harshest)");
  assert.equal(TERRAIN_PROFILE.Water.settlement, null); // still none on open water
});

test("habitability ordering: Plains most, Desert least (harsh), Mountains≈Swamp between", () => {
  const c = Object.fromEntries(LAND.map((t) => [t, TERRAIN_PROFILE[t].settlement.chance]));
  const maxLand = Math.max(...Object.values(c));
  const minLand = Math.min(...Object.values(c));
  assert.equal(c.Plains, maxLand, "Plains should be the most-settled land terrain");
  assert.equal(c.Desert, minLand, "Desert should be the least-settled land terrain");
  assert.equal(c.Mountains, c.Swamp);
  assert.ok(c.Plains > c.Hills && c.Hills > c.Forest && c.Forest > c.Mountains && c.Mountains > c.Desert);
});

// --- Statistical: the constant drives real generateHex output. -------------
// For a forced non-Swamp terrain the FIRST rng() call in generateHex is the
// settlement-presence roll (`rng() < chance`), so feeding N distinct mulberry32
// seeds samples that roll ~uniformly. Deterministic (fixed seeds) — not flaky.

// Real reskewed size table (the suppression test below depends on its weights).
const FULL_SIZE = JSON.parse(readFileSync("./data/settlement-size.json", "utf8"));

function makeTables() {
  const t = new Map();
  t.set("terrain", {
    id: "terrain",
    entries: [{ value: "Plains" }, { value: "Mountains" }, { value: "Water" }],
  });
  t.set("swamp-feature", { id: "swamp-feature", entries: [{ value: "Bog" }] });
  t.set("settlement-size", FULL_SIZE);
  for (const id of ["poi-types", "poi-occupant", "creatures", "occupiers"]) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

const opts = (extra) => ({ key: "0,0", coords: { q: 0, r: 0 }, placed: true, seed: 123, gen: 0, ...extra });

// A forced rng that yields the given values in order, then 0 (for exact,
// stream-position-sensitive assertions).
const forced = (vals) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
};

function settlementRate(tables, terrain, n) {
  let count = 0;
  for (let s = 0; s < n; s++) {
    const hex = generateHex(tables, mulberry32(s), opts({ terrain }));
    if (hex.settlement.present) count++;
  }
  return count / n;
}

test("empirical settlement rate tracks the configured chance (±0.012)", () => {
  const tables = makeTables();
  const N = 3000;
  const plains = settlementRate(tables, "Plains", N);
  const mountains = settlementRate(tables, "Mountains", N);
  assert.ok(Math.abs(plains - TERRAIN_PROFILE.Plains.settlement.chance) <= 0.012, `Plains rate ${plains}`);
  assert.ok(Math.abs(mountains - TERRAIN_PROFILE.Mountains.settlement.chance) <= 0.012, `Mountains rate ${mountains}`);
  assert.ok(plains > mountains + 0.01, "Plains should settle materially more often than Mountains");
});

test("open water never auto-generates a settlement", () => {
  const tables = makeTables();
  assert.equal(settlementRate(tables, "Water", 3000), 0);
});

// nearbyLargeCount softly suppresses a hex rolling large — same rng stream, only
// the size-table weights change, so the SAME forced size roll yields a large
// size with no big neighbours and a small one when big settlements are near.
// Capped Plains table [Thorp16,Hamlet12,Village8,Town3,City1] (total 40): a size
// draw of u=0.95 → target 38.0 → Town (large). At count 2 the Town/City weights
// are ×0.15^2, total ≈ 36.09 → target 34.29 → Village (small).
test("nearbyLargeCount suppresses large sizes without shifting the rng stream", () => {
  const tables = makeTables();
  // forced: presence passes (0.0 < chance), size draw 0.95, POI absent (0.99).
  const near0 = generateHex(tables, forced([0.0, 0.95, 0.99]), opts({ terrain: "Plains", nearbyLargeCount: 0 }));
  const near2 = generateHex(tables, forced([0.0, 0.95, 0.99]), opts({ terrain: "Plains", nearbyLargeCount: 2 }));
  assert.equal(near0.settlement.size, "Town");
  assert.ok(isLargeSize(near0.settlement.size));
  assert.equal(near2.settlement.size, "Village");
  assert.ok(!isLargeSize(near2.settlement.size));
});
