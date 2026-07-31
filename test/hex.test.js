import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateHex } from "../js/gen/hex.js";
import { TERRAINS } from "../js/gen/affinity.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32, subRng } from "../js/core/rng.js";
import { profileFor } from "../js/gen/terrain-profile.js";

const FULL_SIZE = {
  id: "settlement-size",
  entries: ["Hamlet", "Village", "Town", "City"].map((size) => ({
    value: { size },
  })),
};

// Tables for the generator: small in-memory terrain/size + the real POI data.
function makeTables(terrain) {
  const t = new Map();
  t.set("terrain", terrain || { id: "terrain", entries: [{ value: "Plains" }] });
  t.set("swamp-feature", { id: "swamp-feature", entries: [{ value: "Bog" }] });
  t.set("settlement-size", FULL_SIZE);
  for (const id of ["poi-types", "poi-occupant", "creatures", "occupiers"]) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

const sameExceptTime = (a, b) => {
  const { createdAt: _a, ...ra } = a;
  const { createdAt: _b, ...rb } = b;
  assert.deepEqual(ra, rb);
};

const forced = (vals) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
};

const opts = (extra) => ({
  key: "0,0",
  coords: { q: 0, r: 0 },
  placed: true,
  seed: 123,
  gen: 0,
  ...extra,
});

test("generateHex is deterministic for a given seed", () => {
  const t = makeTables();
  const a = generateHex(t, mulberry32(123), opts());
  const b = generateHex(t, mulberry32(123), opts());
  sameExceptTime(a, b);
});

test("pois is an array (typed POIs), empty when chance fails", () => {
  const t = makeTables();
  // forced terrain Plains; settlement absent (0.99), POI presence fails (0.99)
  const hex = generateHex(t, forced([0.99, 0.99]), opts({ terrain: "Plains" }));
  assert.ok(Array.isArray(hex.pois));
  assert.equal(hex.pois.length, 0);
});

test("POIs are typed objects when present", () => {
  const t = makeTables();
  // Plains; settlement absent (0.99), POI present (0.0), count 1d2 -> 1
  const hex = generateHex(t, forced([0.99, 0.0, 0.0]), opts({ terrain: "Plains" }));
  assert.ok(hex.pois.length >= 1);
  for (const p of hex.pois) {
    assert.ok(typeof p.type === "string" && typeof p.name === "string");
    assert.ok(p.occupant && typeof p.occupant.kind === "string");
  }
});

test("no settlement in Water", () => {
  const t = makeTables();
  for (let s = 0; s < 50; s++) {
    const hex = generateHex(t, mulberry32(s), opts({ terrain: "Water" }));
    assert.equal(hex.settlement.present, false);
  }
});

test("no City in Desert (size capped at Town)", () => {
  const t = makeTables();
  // forced terrain Desert; settlement present (0.0); size roll; no POIs (0.99)
  const hex = generateHex(t, forced([0.0, 0.0, 0.99]), opts({ terrain: "Desert" }));
  assert.equal(hex.settlement.present, true);
  assert.notEqual(hex.settlement.size, "City");
});

test("Swamp yields a terrain feature when forced (nested roll still resolves)", () => {
  const t = makeTables({
    id: "terrain",
    entries: [{ value: "Swamp", roll: { table: "swamp-feature" } }, { value: "Plains" }],
  });
  // Terrain comes from the neighbour-affinity roll, not the rng stream; force
  // it directly and confirm the nested swamp-feature roll still fires.
  const hex = generateHex(t, mulberry32(1), opts({ terrain: "Swamp" }));
  assert.equal(hex.terrain, "Swamp");
  assert.equal(hex.terrainFeature, "Bog");
});

test("manual (forced) terrain overrides the classifier; no nested feature outside Swamp", () => {
  const t = makeTables();
  const hex = generateHex(t, mulberry32(7), opts({ terrain: "Mountains" }));
  assert.equal(hex.terrain, "Mountains");
  assert.equal(hex.terrainFeature, null);
});

test("rolled terrain is one of the affinity terrains; no elevation/moisture fields", () => {
  const t = makeTables();
  const hex = generateHex(t, mulberry32(1), opts({ coords: { q: 5, r: 3 } }));
  assert.ok(TERRAINS.includes(hex.terrain), `unexpected terrain ${hex.terrain}`);
  assert.equal(hex.elevation, undefined); // elevation model removed (v13)
  assert.equal(hex.moisture, undefined);
  assert.equal(hex.continent, undefined);
});

test("neighbour terrains bias the affinity roll (surrounded by Sea -> Sea)", () => {
  const t = makeTables();
  const hex = generateHex(t, mulberry32(1), opts({ coords: { q: 5, r: 3 }, neighborTerrains: Array(6).fill("Sea") }));
  assert.equal(hex.terrain, "Sea");
});

test("shipped weighted tables are valid", () => {
  for (const id of ["creatures", "occupiers"]) {
    const table = JSON.parse(readFileSync(`./data/${id}.json`, "utf8"));
    validateTable(table);
    assert.equal(table.id, id);
  }
});

// --- Settlement kind roll: keep vs monastery (Phase 15, Step 2) -------------
// The two overlays are mutually exclusive (a hex has at most one kind); keep is
// rolled first and always wins, monastery only when no keep fired. Both roll from
// their own coord-keyed sub-streams, so neither ever perturbs the main rng /
// downstream POI rolls. `settled` forces a settlement present (main rng 0 → present,
// 0 → smallest size, 0.99 → no POI) so the kind roll actually fires.
const settled = (q, r, seed, gen = 0) =>
  generateHex(makeTables(), forced([0, 0, 0.99]), opts({ key: `${q},${r}`, coords: { q, r }, seed, gen, terrain: "Hills" }));

test("settlement.kind is deterministic for a given seed + coords", () => {
  for (let q = 0; q < 12; q++) for (let r = 0; r < 12; r++) {
    assert.equal(settled(q, r, 4242).settlement.kind, settled(q, r, 4242).settlement.kind, `kind differs at ${q},${r}`);
  }
});

test("the monastery kind roll never perturbs the main rng (its own sub-stream)", () => {
  // A counting forced stream: records how many MAIN-rng draws generateHex makes.
  const counting = (vals) => {
    let i = 0;
    const state = { n: 0 };
    const fn = () => { state.n++; return i < vals.length ? vals[i++] : 0; };
    fn.state = state;
    return fn;
  };
  // Find a coord whose kind is "monastery" and one with no kind (same seed/terrain).
  const seed = 55;
  let monCoord = null;
  let plainCoord = null;
  for (let q = 0; q < 60 && (!monCoord || !plainCoord); q++) {
    for (let r = 0; r < 60 && (!monCoord || !plainCoord); r++) {
      const kind = settled(q, r, seed).settlement.kind;
      if (kind === "monastery" && !monCoord) monCoord = { q, r };
      if (kind === undefined && !plainCoord) plainCoord = { q, r };
    }
  }
  assert.ok(monCoord && plainCoord, "sweep must find both a monastery and a plain settled hex");
  const gen = (c) => {
    const rng = counting([0, 0, 0.99]); // present, size, no POI
    const hex = generateHex(makeTables(), rng, opts({ key: `${c.q},${c.r}`, coords: c, seed, gen: 0, terrain: "Hills" }));
    return { hex, draws: rng.state.n };
  };
  const m = gen(monCoord);
  const p = gen(plainCoord);
  assert.equal(m.hex.settlement.kind, "monastery");
  assert.equal(p.hex.settlement.kind, undefined);
  // Identical main-rng draw count whether or not a monastery fired, and identical
  // main-rng-driven fields (present, size, POI count) — the kind roll is off-stream.
  assert.equal(m.draws, p.draws, "monastery firing changed the main-rng draw count");
  assert.equal(m.hex.settlement.present, p.hex.settlement.present);
  assert.equal(m.hex.settlement.size, p.hex.settlement.size);
  assert.equal(m.hex.pois.length, p.hex.pois.length);
});

test("a hex is never both keep and monastery; keep always wins the kind roll", () => {
  const prof = profileFor("Hills").settlement;
  let sawKeep = false;
  let sawMon = false;
  for (let q = 0; q < 40; q++) for (let r = 0; r < 40; r++) {
    const kind = settled(q, r, 7).settlement.kind;
    assert.ok(kind === undefined || kind === "keep" || kind === "monastery", `unexpected kind ${kind} at ${q},${r}`);
    // Recompute the independent keep roll; if it fires, the kind MUST be keep.
    if (subRng(7, "keep", q, r, 0)() < prof.keepChance) assert.equal(kind, "keep", `keep fired at ${q},${r} but kind=${kind}`);
    if (kind === "keep") sawKeep = true;
    if (kind === "monastery") sawMon = true;
  }
  assert.ok(sawKeep, "expected some keeps in the sweep");
  assert.ok(sawMon, "expected some monasteries in the sweep");
});

test("monasteries are rarer than keeps over a large Hills sweep (kind roll bias)", () => {
  let keep = 0;
  let mon = 0;
  for (let q = 0; q < 60; q++) for (let r = 0; r < 60; r++) {
    const kind = settled(q, r, 31).settlement.kind;
    if (kind === "keep") keep++;
    else if (kind === "monastery") mon++;
  }
  assert.ok(keep > 0 && mon > 0, `expected both kinds (keep=${keep}, mon=${mon})`);
  assert.ok(mon < keep, `monastery count ${mon} should stay below keep count ${keep}`);
});
