import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLand, biomeAt } from "../js/gen/biome.js";

const LAND_TERRAINS = ["Forest", "Plains", "Hills", "Mountains", "Swamp", "Desert", "Lake"];
const KNOWN_TERRAINS = [...LAND_TERRAINS, "Sea"];

test("classifyLand: high elevation -> Mountains, regardless of moisture", () => {
  assert.equal(classifyLand(0.68, 0.1), "Mountains");
  assert.equal(classifyLand(0.9, 0.9), "Mountains");
  assert.equal(classifyLand(0.68, 0), "Mountains");
});

test("classifyLand: just below the Mountains threshold -> Hills band", () => {
  assert.equal(classifyLand(0.6799, 0.5), "Hills");
});

test("classifyLand: mid-high elevation -> Hills, regardless of moisture", () => {
  assert.equal(classifyLand(0.58, 0.0), "Hills");
  assert.equal(classifyLand(0.6, 1.0), "Hills");
});

test("classifyLand: low elevation + high moisture -> Swamp", () => {
  assert.equal(classifyLand(0.1, 0.9), "Swamp");
  assert.equal(classifyLand(0.34, 0.47), "Swamp");
});

test("classifyLand: low elevation + low moisture -> Lake, never Sea (Sea isn't reachable from here)", () => {
  assert.equal(classifyLand(0.1, 0.1), "Lake");
  assert.equal(classifyLand(0.34, 0.4699), "Lake");
  assert.equal(classifyLand(0, 0), "Lake");
});

test("classifyLand: mid elevation splits Desert/Plains/Forest by moisture", () => {
  assert.equal(classifyLand(0.45, 0.1), "Desert");
  assert.equal(classifyLand(0.45, 0.4), "Plains");
  assert.equal(classifyLand(0.45, 0.6), "Forest");
});

test("classifyLand: boundary values are consistent (>= not >)", () => {
  assert.equal(classifyLand(0.35, 0.34), "Desert"); // right at the mid-band floor
  assert.equal(classifyLand(0.5, 0.35), "Plains"); // right at the desert/plains line
  assert.equal(classifyLand(0.5, 0.51), "Forest"); // right at the plains/forest line
});

test("classifyLand: always returns a known LAND terrain, across the full grid", () => {
  for (let e = 0; e <= 1; e += 0.05) {
    for (let m = 0; m <= 1; m += 0.05) {
      assert.ok(LAND_TERRAINS.includes(classifyLand(e, m)), `unexpected terrain at e=${e} m=${m}`);
    }
  }
});

test("biomeAt: deterministic — same (seed,q,r) always gives the same result", () => {
  assert.deepEqual(biomeAt(1, 3, -2), biomeAt(1, 3, -2));
});

test("biomeAt: returns a continent field alongside elevation/moisture", () => {
  const { continent } = biomeAt(1, 3, -2);
  assert.equal(typeof continent, "number");
});

test("biomeAt: seaNeighborCount 0 (default) behaves identically to the pure position-based roll", () => {
  for (const [seed, q, r] of [[1, 3, -2], [2, 40, 40], ["seed", -5, 8]]) {
    assert.deepEqual(biomeAt(seed, q, r), biomeAt(seed, q, r, 0));
  }
});

test("biomeAt: a high seaNeighborCount makes Sea overwhelmingly likely", () => {
  // Statistical: 6 sea neighbours -> ~99.98% per-trial chance, so Sea should
  // dominate heavily across many independent (seed, coord) draws.
  let seaCount = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const { terrain } = biomeAt(`seed-${i}`, 40 + i, 40, 6);
    if (terrain === "Sea") seaCount++;
  }
  assert.ok(seaCount / trials > 0.9, `expected >90% Sea with 6 sea neighbours, got ${seaCount}/${trials}`);
});

test("biomeAt: sea contagion always leaves an escape hatch — never certain", () => {
  // A lower neighbour count (chance ~94%, not ~99.98%) makes the escape
  // hatch observable within a modest, non-flaky number of trials.
  let landCount = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const { terrain } = biomeAt(`seed-${i}`, 40 + i, 40, 2);
    if (terrain !== "Sea") landCount++;
  }
  assert.ok(landCount > 0, "expected at least one non-Sea escape across 200 trials at seaNeighborCount=2");
});

test("biomeAt: seaNeighborCount never triggers with 0 neighbours (falls through to continent gate)", () => {
  // Confirms the contagion roll is gated on seaNeighborCount, not always-on.
  for (let i = 0; i < 50; i++) {
    const withZero = biomeAt(`seed-${i}`, 40, 40, 0);
    const withoutParam = biomeAt(`seed-${i}`, 40, 40);
    assert.deepEqual(withZero, withoutParam);
  }
});

test("biomeAt: origin (0,0) is always land, never Sea, regardless of seed", () => {
  // The world's spawn point is always (0,0) (app.js onNewWorld) — without the
  // origin land-bias, some seeds place it deep in an ocean basin. Regression
  // test for that fix.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "alpha", "beta", 42, 1000]) {
    const { terrain } = biomeAt(seed, 0, 0);
    assert.notEqual(terrain, "Sea", `seed ${seed} put Sea at the origin`);
  }
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
  const a = biomeAt(1, 30, 30);
  const b = biomeAt(2, 30, 30);
  assert.notDeepEqual(a, b);
});

test("biomeAt: always returns one of the known terrains", () => {
  for (let q = -30; q <= 30; q += 3) {
    for (let r = -30; r <= 30; r += 3) {
      const { terrain } = biomeAt("seed", q, r);
      assert.ok(KNOWN_TERRAINS.includes(terrain), `unexpected terrain ${terrain} at (${q},${r})`);
    }
  }
});
