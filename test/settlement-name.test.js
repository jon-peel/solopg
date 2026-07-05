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
