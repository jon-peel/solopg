import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBiome, biomeAt } from "../js/gen/biome.js";

const KNOWN_TERRAINS = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert", "Lake", "Sea"];

test("classifyBiome: high elevation -> Mountains, regardless of moisture/basin", () => {
  assert.equal(classifyBiome(0.68, 0.1, 0.5), "Mountains");
  assert.equal(classifyBiome(0.9, 0.9, 0.9), "Mountains");
  assert.equal(classifyBiome(0.68, 0, 0), "Mountains");
});

test("classifyBiome: just below the Mountains threshold -> Hills band", () => {
  assert.equal(classifyBiome(0.6799, 0.5, 0.5), "Hills");
});

test("classifyBiome: mid-high elevation -> Hills, regardless of moisture/basin", () => {
  assert.equal(classifyBiome(0.58, 0.0, 0.5), "Hills");
  assert.equal(classifyBiome(0.6, 1.0, 0.5), "Hills");
});

test("classifyBiome: low elevation + high moisture -> Swamp, regardless of basin", () => {
  assert.equal(classifyBiome(0.1, 0.9, 0), "Swamp");
  assert.equal(classifyBiome(0.1, 0.9, 1), "Swamp");
  assert.equal(classifyBiome(0.34, 0.47), "Swamp");
});

test("classifyBiome: low elevation + low moisture splits Sea/Lake by basin", () => {
  assert.equal(classifyBiome(0.1, 0.1, 0.4999), "Sea");
  assert.equal(classifyBiome(0.1, 0.1, 0.5), "Lake");
  assert.equal(classifyBiome(0.34, 0.4699, 0.1), "Sea");
  assert.equal(classifyBiome(0.34, 0.4699, 0.9), "Lake");
});

test("classifyBiome: mid elevation splits Desert/Plains/Forest by moisture", () => {
  assert.equal(classifyBiome(0.45, 0.1), "Desert");
  assert.equal(classifyBiome(0.45, 0.4), "Plains");
  assert.equal(classifyBiome(0.45, 0.6), "Forest");
});

test("classifyBiome: boundary values are consistent (>= not >)", () => {
  assert.equal(classifyBiome(0.35, 0.34), "Desert"); // right at the mid-band floor
  assert.equal(classifyBiome(0.5, 0.35), "Plains"); // right at the desert/plains line
  assert.equal(classifyBiome(0.5, 0.51), "Forest"); // right at the plains/forest line
});

test("classifyBiome: always returns one of the known terrains, across the full grid", () => {
  for (let e = 0; e <= 1; e += 0.1) {
    for (let m = 0; m <= 1; m += 0.1) {
      for (let b = 0; b <= 1; b += 0.25) {
        assert.ok(KNOWN_TERRAINS.includes(classifyBiome(e, m, b)), `unexpected terrain at e=${e} m=${m} b=${b}`);
      }
    }
  }
});

test("biomeAt: deterministic — same (seed,q,r) always gives the same result", () => {
  assert.deepEqual(biomeAt(1, 3, -2), biomeAt(1, 3, -2));
});

test("biomeAt: returns a basin field alongside elevation/moisture, in [0,1)", () => {
  const { basin } = biomeAt(1, 3, -2);
  assert.equal(typeof basin, "number");
  assert.ok(basin >= 0 && basin < 1);
});

test("biomeAt: pure function of position — order of calls doesn't matter", () => {
  const a1 = biomeAt("seed", 5, 5);
  biomeAt("seed", -100, 42); // an unrelated call in between
  const a2 = biomeAt("seed", 5, 5);
  assert.deepEqual(a1, a2);
});

test("biomeAt: different coords generally give different results", () => {
  const results = new Set();
  for (let q = -10; q <= 10; q++) results.add(JSON.stringify(biomeAt("seed", q, 0)));
  assert.ok(results.size > 1, "expected variation across coordinates");
});

test("biomeAt: different seeds give different worlds at the same coords", () => {
  const a = biomeAt(1, 3, 3);
  const b = biomeAt(2, 3, 3);
  assert.notDeepEqual(a, b);
});
