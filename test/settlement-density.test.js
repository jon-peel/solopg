import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateHex } from "../js/gen/hex.js";
import { mulberry32 } from "../js/core/rng.js";
import { TERRAIN_PROFILE } from "../js/gen/terrain-profile.js";

// 3R.6 (Settlements v2, step A): auto-generation settlement chances were dialed
// down ~4x so settlements read as occasional landmarks, not a carpet. These
// tests pin the dialed-down band (so the old 0.30–0.45 rates can't creep back),
// preserve the habitability ordering, and tie the constants to real generateHex
// output.

const LAND = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert"];

test("every land settlement chance is dialed down (<= 0.12; Plains <= 0.10)", () => {
  for (const t of LAND) {
    const c = TERRAIN_PROFILE[t].settlement.chance;
    assert.ok(c > 0 && c <= 0.12, `${t} chance ${c} outside the dialed-down band`);
  }
  assert.ok(TERRAIN_PROFILE.Plains.settlement.chance <= 0.1);
  assert.equal(TERRAIN_PROFILE.Water.settlement, null); // still none on open water
});

test("habitability ordering preserved (Plains most, Mountains/Swamp least)", () => {
  const c = Object.fromEntries(LAND.map((t) => [t, TERRAIN_PROFILE[t].settlement.chance]));
  const maxLand = Math.max(...Object.values(c));
  const minLand = Math.min(...Object.values(c));
  assert.equal(c.Plains, maxLand, "Plains should be the most-settled land terrain");
  assert.equal(c.Mountains, minLand);
  assert.equal(c.Swamp, minLand);
  assert.ok(c.Plains > c.Hills && c.Hills > c.Forest && c.Forest > c.Desert && c.Desert > c.Mountains);
});

// --- Statistical: the constant drives real generateHex output. -------------
// For a forced non-Swamp terrain the FIRST rng() call in generateHex is the
// settlement-presence roll (`rng() < chance`), so feeding N distinct mulberry32
// seeds samples that roll ~uniformly. Deterministic (fixed seeds) — not flaky.

const FULL_SIZE = {
  id: "settlement-size",
  entries: ["Thorp", "Hamlet", "Village", "Town", "City"].map((size) => ({ value: { size } })),
};

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

function settlementRate(tables, terrain, n) {
  let count = 0;
  for (let s = 0; s < n; s++) {
    const hex = generateHex(tables, mulberry32(s), opts({ terrain }));
    if (hex.settlement.present) count++;
  }
  return count / n;
}

test("empirical settlement rate tracks the configured chance (±0.03)", () => {
  const tables = makeTables();
  const N = 3000;
  const plains = settlementRate(tables, "Plains", N);
  const mountains = settlementRate(tables, "Mountains", N);
  assert.ok(Math.abs(plains - TERRAIN_PROFILE.Plains.settlement.chance) <= 0.03, `Plains rate ${plains}`);
  assert.ok(Math.abs(mountains - TERRAIN_PROFILE.Mountains.settlement.chance) <= 0.03, `Mountains rate ${mountains}`);
  assert.ok(plains > mountains + 0.03, "Plains should settle materially more often than Mountains");
});

test("open water never auto-generates a settlement", () => {
  const tables = makeTables();
  assert.equal(settlementRate(tables, "Water", 3000), 0);
});
