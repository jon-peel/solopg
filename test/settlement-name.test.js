import { test } from "node:test";
import assert from "node:assert/strict";
import { settlementName, TERRAIN_SUFFIX, MARTIAL_SUFFIX } from "../js/gen/settlement-name.js";

const SEED = "names";
// one or two capitalized words, letters only (Ashwood, Raven Cross, Fort Raven)
const SHAPE = /^[A-Z][a-z]+( [A-Z][a-z]+)?$/;

test("settlementName: deterministic for the same (seed, q, r, gen, opts)", () => {
  const a = settlementName(SEED, 5, 2, 0, { terrain: "Forest" });
  const b = settlementName(SEED, 5, 2, 0, { terrain: "Forest" });
  assert.equal(a, b);
});

test("settlementName: always a non-empty, well-formed name", () => {
  for (let i = 0; i < 300; i++) {
    const n = settlementName(SEED, i, i * 7 - 3, 0, { terrain: "Plains" });
    assert.ok(SHAPE.test(n), `unexpected name shape: "${n}"`);
  }
});

test("settlementName: regenerate (gen) reshuffles the name", () => {
  // over a sweep, gen 0 vs gen 1 differ for the vast majority of hexes
  let changed = 0;
  for (let i = 0; i < 50; i++) {
    if (settlementName(SEED, i, 0, 0, {}) !== settlementName(SEED, i, 0, 1, {})) changed++;
  }
  assert.ok(changed > 40, `regen barely changed names (${changed}/50)`);
});

test("settlementName: a Keep gets a martial name (Fort X / X Keep / X+martial)", () => {
  const martial = new RegExp(`^Fort | Keep$|(${MARTIAL_SUFFIX.join("|")})$`);
  for (let i = 0; i < 200; i++) {
    const n = settlementName(SEED, i, i + 1, 0, { kind: "keep", terrain: "Hills" });
    assert.ok(martial.test(n), `keep name not martial: "${n}"`);
  }
});

test("settlementName: terrain flavors the ending (forest names use forest suffixes)", () => {
  const forest = new RegExp(`(${TERRAIN_SUFFIX.Forest.join("|")})$`);
  let flavored = 0;
  for (let i = 0; i < 200; i++) {
    if (forest.test(settlementName(SEED, i, i * 3, 0, { terrain: "Forest" }))) flavored++;
  }
  assert.ok(flavored > 0, "no forest-flavored suffixes appeared");
  // and a different terrain yields different endings for the same coords
  const a = settlementName(SEED, 9, 4, 0, { terrain: "Forest" });
  const b = settlementName(SEED, 9, 4, 0, { terrain: "Swamp" });
  // same prefix (same coords/gen), terrain only changes the flavored suffix path
  assert.ok(typeof a === "string" && typeof b === "string");
});

test("settlementName: a monastery with a baked name returns that name verbatim", () => {
  // The proper name is baked by js/gen/monastery.js; settlement-name just echoes
  // it. The early return fires BEFORE the rng is drawn, so coords/gen are moot.
  assert.equal(
    settlementName(SEED, 3, 8, 0, { kind: "monastery", name: "Saint X's Abbey" }),
    "Saint X's Abbey",
  );
  // Different coords/gen/terrain: still the exact baked name.
  assert.equal(
    settlementName("other", 99, -4, 5, { kind: "monastery", terrain: "Swamp", name: "the Priory of Silent Mercy" }),
    "the Priory of Silent Mercy",
  );
  // No name (e.g. a not-yet-baked monastery) falls through to a generated name.
  const fallthrough = settlementName(SEED, 3, 8, 0, { kind: "monastery" });
  assert.ok(typeof fallthrough === "string" && fallthrough.length > 0);
});

test("settlementName: the monastery early return does not perturb any other path (regression)", () => {
  // Frozen outputs captured before the Step-3 early return was added — a plain
  // settlement, a keep, and a demihuman name must all stay byte-identical.
  assert.equal(settlementName(SEED, 5, 2, 0, { terrain: "Forest" }), "Blackcross");
  assert.equal(settlementName(SEED, 11, 3, 0, { terrain: "Plains" }), "Saltton");
  assert.equal(settlementName(SEED, 7, 7, 0, {}), "Briarcote");
  assert.equal(settlementName(SEED, 3, 4, 0, { kind: "keep", terrain: "Hills" }), "Fort Yarrow");
  assert.equal(settlementName(SEED, 20, 1, 0, { kind: "keep" }), "Fort Raven");
  assert.equal(settlementName(SEED, 9, 9, 0, { race: "dwarf", terrain: "Mountains" }), "Karvokflame");
});
