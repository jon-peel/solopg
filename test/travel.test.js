import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAVEL_COST, ROAD_PACE_MULTIPLIER, ENCUMBRANCE_FACTOR, paceFor, daysToCross,
  LOST_CHANCE, rollGetLost, deviateDirection,
} from "../js/gen/travel.js";
import { NEIGHBOR_DIRS } from "../js/core/hexgeo.js";

test("TRAVEL_COST covers every terrain with the documented pace", () => {
  assert.deepEqual(TRAVEL_COST, {
    Plains: 4, Forest: 2, Hills: 2, Desert: 2, Swamp: 1, Mountains: 1, Lake: 0, Sea: 0,
  });
});

test("paceFor matches the terrain table off-road", () => {
  assert.equal(paceFor("Plains"), 4);
  assert.equal(paceFor("Forest"), 2);
  assert.equal(paceFor("Hills"), 2);
  assert.equal(paceFor("Desert"), 2);
  assert.equal(paceFor("Swamp"), 1);
  assert.equal(paceFor("Mountains"), 1);
});

test("paceFor doubles pace on a road", () => {
  assert.equal(paceFor("Plains", { road: true }), 8);
  assert.equal(paceFor("Swamp", { road: true }), 2);
  assert.equal(ROAD_PACE_MULTIPLIER, 2);
});

test("paceFor is 0 (impassable) on Lake/Sea, on or off road", () => {
  assert.equal(paceFor("Lake"), 0);
  assert.equal(paceFor("Sea"), 0);
  assert.equal(paceFor("Lake", { road: true }), 0);
  assert.equal(paceFor("Sea", { road: true }), 0);
});

test("paceFor defaults an unknown terrain to impassable rather than throwing", () => {
  assert.equal(paceFor("Nonsense"), 0);
});

test("daysToCross is the reciprocal of pace", () => {
  assert.equal(daysToCross("Plains"), 1 / 4);
  assert.equal(daysToCross("Swamp"), 1);
  assert.equal(daysToCross("Plains", { road: true }), 1 / 8);
});

test("daysToCross is Infinity when impassable", () => {
  assert.equal(daysToCross("Sea"), Infinity);
  assert.equal(daysToCross("Lake"), Infinity);
});

test("paceFor defaults to unencumbered — today's numbers are unchanged", () => {
  assert.equal(paceFor("Plains"), paceFor("Plains", { encumbrance: "unencumbered" }));
  assert.equal(paceFor("Plains", { road: true }), paceFor("Plains", { road: true, encumbrance: "unencumbered" }));
});

test("ENCUMBRANCE_FACTOR matches the B/X tooltip ladder (1 / .75 / .5 / .25)", () => {
  assert.deepEqual(ENCUMBRANCE_FACTOR, { unencumbered: 1, light: 0.75, encumbered: 0.5, heavy: 0.25 });
});

test("paceFor scales by encumbrance tier", () => {
  assert.equal(paceFor("Plains", { encumbrance: "light" }), 3);
  assert.equal(paceFor("Plains", { encumbrance: "encumbered" }), 2);
  assert.equal(paceFor("Plains", { encumbrance: "heavy" }), 1);
});

test("paceFor combines road and encumbrance multiplicatively", () => {
  assert.equal(paceFor("Plains", { road: true, encumbrance: "heavy" }), 2); // 4 * 2 * 0.25
});

test("paceFor stays impassable on Lake/Sea regardless of encumbrance", () => {
  assert.equal(paceFor("Sea", { encumbrance: "light" }), 0);
  assert.equal(paceFor("Lake", { encumbrance: "heavy" }), 0);
});

test("paceFor falls back to unencumbered for an unrecognised encumbrance tier", () => {
  assert.equal(paceFor("Plains", { encumbrance: "sprinting" }), 4);
});

// --- Getting lost (Phase 8.3) ---------------------------------------------

test("LOST_CHANCE covers every terrain with the documented d6 odds", () => {
  assert.deepEqual(LOST_CHANCE, {
    Plains: 1 / 6, Forest: 2 / 6, Hills: 2 / 6, Desert: 2 / 6, Swamp: 3 / 6, Mountains: 3 / 6, Lake: 0, Sea: 0,
  });
});

test("rollGetLost is deterministic for the same (seed, day, q, r)", () => {
  const a = rollGetLost("seed-1", 3, 5, -2, "Swamp");
  const b = rollGetLost("seed-1", 3, 5, -2, "Swamp");
  assert.equal(a, b);
});

test("rollGetLost is always false on a road, whatever the terrain", () => {
  for (let day = 0; day < 20; day++) {
    assert.equal(rollGetLost("seed-road", day, 0, 0, "Mountains", { road: true }), false);
  }
});

test("rollGetLost is always false where LOST_CHANCE is 0 (Lake/Sea)", () => {
  for (let day = 0; day < 20; day++) {
    assert.equal(rollGetLost("seed-water", day, 0, 0, "Lake"), false);
    assert.equal(rollGetLost("seed-water", day, 0, 0, "Sea"), false);
  }
});

test("rollGetLost's empirical rate roughly matches LOST_CHANCE (sampled over many days/positions)", () => {
  for (const terrain of ["Plains", "Mountains"]) {
    const chance = LOST_CHANCE[terrain];
    const N = 4000;
    let lostCount = 0;
    for (let i = 0; i < N; i++) {
      // Vary q/r as well as day so the sample isn't a single subRng stream.
      if (rollGetLost("rate-seed", i, i % 37, (i * 7) % 41, terrain)) lostCount++;
    }
    const rate = lostCount / N;
    assert.ok(
      Math.abs(rate - chance) < 0.03,
      `${terrain}: empirical rate ${rate.toFixed(3)} too far from expected ${chance.toFixed(3)}`,
    );
  }
});

test("deviateDirection only ever returns one of the two adjacent directions (never same/opposite)", () => {
  for (let intendedDir = 0; intendedDir < 6; intendedDir++) {
    const left = (intendedDir + 5) % 6;
    const right = (intendedDir + 1) % 6;
    for (let day = 0; day < 30; day++) {
      const dir = deviateDirection(`dev-${intendedDir}`, day, 0, 0, intendedDir);
      assert.ok(dir === left || dir === right, `expected an adjacent dir, got ${dir}`);
    }
  }
});

test("deviateDirection is deterministic for the same (seed, day, q, r, intendedDir)", () => {
  const a = deviateDirection("seed-x", 5, 1, 1, 2);
  const b = deviateDirection("seed-x", 5, 1, 1, 2);
  assert.equal(a, b);
});

test("deviateDirection swaps to the other side when the first pick is impassable", () => {
  const intendedDir = 0;
  const left = (intendedDir + 5) % 6;
  const right = (intendedDir + 1) % 6;
  // Find a (day) where the unconstrained roll picks `left` first, then confirm
  // blocking `left` makes it return `right` instead.
  let day = 0;
  let unconstrained;
  do {
    unconstrained = deviateDirection("swap-seed", day, 0, 0, intendedDir);
    day++;
  } while (unconstrained !== left && day < 100);
  assert.equal(unconstrained, left, "test setup: expected to find a day where left is picked first");
  const constrained = deviateDirection("swap-seed", day - 1, 0, 0, intendedDir, (d) => d !== left);
  assert.equal(constrained, right);
});

test("deviateDirection falls back to intendedDir when both adjacent hexes are impassable", () => {
  const dir = deviateDirection("blocked-seed", 1, 0, 0, 3, () => false);
  assert.equal(dir, 3);
});

test("NEIGHBOR_DIRS has exactly 6 entries (sanity check for the mod-6 adjacency math above)", () => {
  assert.equal(NEIGHBOR_DIRS.length, 6);
});
