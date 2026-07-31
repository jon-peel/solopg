// Phase 14.1 — race-aware naming. Covers the new `race` argument added to
// settlementName / regionName / rollTavern, and (critically) that omitting it
// leaves the Human path untouched. See docs/plans/phase-14-cultures.md §4/§5.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settlementName } from "../js/gen/settlement-name.js";
import { regionName, computeRegions } from "../js/gen/regions.js";
import { rollTavern, ORACLE_TABLE_IDS } from "../js/gen/oracle.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32, subRng } from "../js/core/rng.js";
import { axialKey } from "../js/core/hexgeo.js";
import { RACES, RACE_NAME_POOLS } from "../js/gen/culture-data.js";

// One or two words, letters/apostrophe/hyphen/diaeresis only (Karr-dûr, Cael'thas,
// Tuckborough, Raven Cross, Fort Raven) — a superset of settlement-name.test.js's
// SHAPE that also allows the race joiners.
const SHAPE = /^[A-Z][A-Za-zûÛ'-]*( [A-Z][A-Za-zûÛ'-]*)?$/;

function oracleTables() {
  const map = new Map();
  for (const id of ORACLE_TABLE_IDS) {
    const t = validateTable(JSON.parse(readFileSync(new URL(`../data/${id}.json`, import.meta.url))));
    map.set(id, t);
  }
  return map;
}

// --- settlementName ----------------------------------------------------------

test("settlementName: every race yields a plausible, well-formed name", () => {
  for (const race of RACES) {
    for (let i = 0; i < 200; i++) {
      const n = settlementName("names", i, i * 7 - 3, 0, { terrain: "Plains", race });
      assert.ok(SHAPE.test(n), `${race}: unexpected name shape "${n}"`);
    }
  }
});

test("settlementName: race path is deterministic for the same (seed, q, r, gen, opts)", () => {
  for (const race of RACES) {
    const a = settlementName("names", 5, 2, 0, { terrain: "Forest", race });
    const b = settlementName("names", 5, 2, 0, { terrain: "Forest", race });
    assert.equal(a, b);
  }
});

test("settlementName: a demihuman Keep still reads as martial (Fort X / X Keep / fused)", () => {
  const martial = /^Fort | Keep$|^[A-Za-zûÛ'-]+$/; // fused form has no space at all
  for (const race of RACES) {
    for (let i = 0; i < 100; i++) {
      const n = settlementName("names", i, i + 1, 0, { kind: "keep", terrain: "Hills", race });
      assert.ok(martial.test(n), `${race} keep name not martial-shaped: "${n}"`);
    }
  }
});

test("settlementName: different races give different names for the same coordinates (races are distinguishable)", () => {
  const byRace = RACES.map((race) => settlementName("names", 9, 4, 0, { terrain: "Forest", race }));
  assert.equal(new Set(byRace).size, byRace.length, `races collided: ${JSON.stringify(byRace)}`);
});

test("settlementName: race draws only from that race's own pools (never the Human pools)", () => {
  for (const race of RACES) {
    const pools = RACE_NAME_POOLS[race];
    const humanPrefixWords = new Set(pools.prefixes); // just to sanity-check pool shape below
    assert.ok(humanPrefixWords.size > 0);
    for (let i = 0; i < 80; i++) {
      const n = settlementName("names", i, -i * 2, 0, { race });
      // The one/two-word body (strip a leading "Fort "/trailing " Keep" if a keep
      // slipped through — it can't here since kind isn't "keep", but stay safe).
      const body = n.replace(/^Fort /, "").replace(/ Keep$/, "");
      const firstWord = body.split(" ")[0];
      // The name must start with one of the race's own prefixes.
      assert.ok(
        pools.prefixes.some((p) => firstWord.startsWith(p)),
        `${race} name "${n}" doesn't start with one of its own prefixes`,
      );
    }
  }
});

test("settlementName: an unknown race string falls back to the Human path (no crash, no pool lookup)", () => {
  const a = settlementName("names", 5, 2, 0, { terrain: "Forest" });
  const b = settlementName("names", 5, 2, 0, { terrain: "Forest", race: "orc" });
  assert.equal(a, b, "an unrecognized race should behave exactly like no race at all");
});

test("settlementName: omitting race (the Human/default path) is unaffected by the new parameter existing", () => {
  // Same assertions settlement-name.test.js already makes, re-affirmed here as a
  // Phase 14.1 regression guard tied to this exact change.
  const a = settlementName("names", 5, 2, 0, { terrain: "Forest" });
  const b = settlementName("names", 5, 2, 0, { terrain: "Forest" });
  assert.equal(a, b);
  const c = settlementName("names", 5, 2, 0, { terrain: "Forest", race: undefined });
  assert.equal(a, c, "an explicit race:undefined must match omitting race entirely");
});

// --- regionName ----------------------------------------------------------------

test("regionName: every race yields a plausible 'the X' (or fused) realm name", () => {
  for (const race of RACES) {
    for (let i = 0; i < 60; i++) {
      const n = regionName("names", "Forest", axialKey(i, -i), race);
      assert.ok(/^the [A-Za-z]/.test(n), `${race}: unexpected region name "${n}"`);
    }
  }
});

test("regionName: race path is deterministic for the same (seed, terrain, anchor, race)", () => {
  for (const race of RACES) {
    const a = regionName("names", "Mountains", axialKey(0, 0), race);
    const b = regionName("names", "Mountains", axialKey(0, 0), race);
    assert.equal(a, b);
  }
});

test("regionName: race name ignores the Human terrain-noun table (same terrain, different races differ)", () => {
  const byRace = RACES.map((race) => regionName("names", "Swamp", axialKey(3, 3), race));
  assert.equal(new Set(byRace).size, byRace.length, `races collided: ${JSON.stringify(byRace)}`);
});

test("regionName: omitting race is unaffected (Human path unchanged)", () => {
  const a = regionName("s", "Swamp", axialKey(0, 0));
  const b = regionName("s", "Swamp", axialKey(0, 0), undefined);
  assert.equal(a, b);
});

test("computeRegions: still works and stays deterministic with race omitted (no wiring yet)", () => {
  const terr = new Map();
  for (let q = 0; q <= 3; q++) for (let r = 0; r <= 3; r++) terr.set(axialKey(q, r), "Forest");
  const a = computeRegions("s", terr, { minSize: 8 });
  const b = computeRegions("s", terr, { minSize: 8 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 1);
  assert.equal(a[0].terrain, "Forest");
});

// --- rollTavern ------------------------------------------------------------

test("rollTavern: every race yields a plausible 'The X Y' sign, specialty/quirk still from the tables", () => {
  const tables = oracleTables();
  const specialties = new Set(tables.get("tavern-specialty").entries.map((e) => e.value));
  const quirks = new Set(tables.get("tavern-quirk").entries.map((e) => e.value));
  for (const race of RACES) {
    for (let s = 0; s < 80; s++) {
      const p = rollTavern(tables, mulberry32(s), race);
      assert.equal(p.kind, "tavern");
      assert.match(p.sign, /^The [A-Za-z]+ [A-Za-z]+$/, `${race}: bad sign "${p.sign}"`);
      assert.ok(specialties.has(p.specialty));
      assert.ok(quirks.has(p.quirk));
    }
  }
});

test("rollTavern: race sign is deterministic for a given stream", () => {
  const tables = oracleTables();
  for (const race of RACES) {
    const a = rollTavern(tables, mulberry32(64), race);
    const b = rollTavern(tables, mulberry32(64), race);
    assert.deepEqual(a, b);
  }
});

test("rollTavern: race sign words come only from that race's own tavernWords pool", () => {
  const tables = oracleTables();
  for (const race of RACES) {
    const words = new Set(RACE_NAME_POOLS[race].tavernWords);
    for (let s = 0; s < 60; s++) {
      const p = rollTavern(tables, mulberry32(s), race);
      const [, a, b] = p.sign.match(/^The (\S+) (\S+)$/);
      assert.ok(words.has(a), `${race}: "${a}" not in its tavernWords pool`);
      assert.ok(words.has(b), `${race}: "${b}" not in its tavernWords pool`);
    }
  }
});

test("rollTavern: an unknown race falls back to the curated Human sign table (no crash)", () => {
  const tables = oracleTables();
  const signs = new Set(tables.get("tavern-sign").entries.map((e) => e.value));
  const p = rollTavern(tables, mulberry32(1), "orc");
  assert.ok(signs.has(p.sign));
});

test("rollTavern: omitting race matches the two-argument call exactly (Human path unchanged)", () => {
  const tables = oracleTables();
  for (let s = 0; s < 100; s++) {
    const a = rollTavern(tables, mulberry32(s));
    const b = rollTavern(tables, mulberry32(s), undefined);
    assert.deepEqual(a, b);
  }
});

// --- App-level determinism check via subRng, mirroring how app.js seeds these --

test("race-aware calls stay deterministic through the app's own subRng seeding pattern", () => {
  const tables = oracleTables();
  for (const race of RACES) {
    const rngA = subRng("world1", "taverns", 4, -2, 0);
    const rngB = subRng("world1", "taverns", 4, -2, 0);
    assert.deepEqual(rollTavern(tables, rngA, race), rollTavern(tables, rngB, race));
  }
});
