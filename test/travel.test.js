import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAVEL_COST, ROAD_PACE_MULTIPLIER, ENCUMBRANCE_FACTOR, paceFor, daysToCross,
  LOST_CHANCE, rollGetLost, deviateDirection,
  roadHexKeySet, planRoute, planMoveToward,
} from "../js/gen/travel.js";
import { NEIGHBOR_DIRS, axialKey } from "../js/core/hexgeo.js";

// A filled axial box of one terrain, with per-hex overrides (keyed by axialKey) —
// same helper shape as test/roads.test.js's boardRect.
function boardRect(qMin, qMax, rMin, rMax, terrain = "Plains", overrides = {}) {
  const t = new Map();
  for (let q = qMin; q <= qMax; q++) for (let r = rMin; r <= rMax; r++) t.set(axialKey(q, r), terrain);
  for (const [k, v] of Object.entries(overrides)) t.set(k, v);
  return t;
}

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

// --- Route-finding + day-by-day movement (Phase 8.4) ----------------------

test("roadHexKeySet collects every hex any road's path passes through", () => {
  const roads = [
    { path: [{ q: 0, r: 0 }, { q: 1, r: 0 }] },
    { path: [{ q: 1, r: 0 }, { q: 1, r: 1 }] }, // shares a hex with the first
  ];
  const keys = roadHexKeySet(roads);
  assert.deepEqual([...keys].sort(), ["0,0", "1,0", "1,1"]);
});

test("roadHexKeySet is empty for no roads", () => {
  assert.equal(roadHexKeySet([]).size, 0);
  assert.equal(roadHexKeySet(undefined).size, 0);
});

test("planRoute returns null when the start or the goal is unplaced", () => {
  const terr = boardRect(0, 3, 0, 0);
  assert.equal(planRoute(0, 0, 9, 9, terr, new Set()), null); // goal unplaced
  assert.equal(planRoute(9, 9, 0, 0, terr, new Set()), null); // start unplaced
});

test("planRoute returns a trivial zero-day route when start === goal", () => {
  const terr = boardRect(0, 3, 0, 0);
  const route = planRoute(1, 0, 1, 0, terr, new Set());
  assert.deepEqual(route, { path: [{ q: 1, r: 0 }], days: 0 });
});

test("planRoute returns null when no connected placed-hex path exists (Sea gap)", () => {
  const terr = boardRect(0, 4, 0, 0, "Plains", { "2,0": "Sea" });
  assert.equal(planRoute(0, 0, 4, 0, terr, new Set()), null);
});

test("planRoute costs a straight all-Plains line at the documented pace", () => {
  const terr = boardRect(0, 4, 0, 0);
  const route = planRoute(0, 0, 4, 0, terr, new Set());
  assert.equal(route.path.length, 5); // start-inclusive, 4 steps
  assert.equal(route.days, 4 * daysToCross("Plains"));
});

test("planRoute prefers a road even via a longer (more-hexes) detour, when it's fewer total days", () => {
  // r=0: Plains, no road (direct, 4 hexes). r=1: Plains, ALL road (a detour
  // that's 5 hexes but each entered at half the day-cost).
  const terr = boardRect(-1, 5, 0, 1);
  const roadKeys = new Set();
  for (let q = -1; q <= 5; q++) roadKeys.add(axialKey(q, 1));

  const direct = planRoute(0, 0, 4, 0, terr, new Set());
  assert.equal(direct.days, 4 * daysToCross("Plains"), "no road available: straight line, 4 days-worth");

  const withRoad = planRoute(0, 0, 4, 0, terr, roadKeys);
  assert.ok(withRoad.days < direct.days, `expected the road detour to be cheaper: ${withRoad.days} vs ${direct.days}`);
  assert.ok(
    withRoad.path.some((p) => p.r === 1),
    "expected the cheaper route to actually use the road row",
  );
});

test("planMoveToward: start === target arrives immediately with no days spent", () => {
  const terr = boardRect(0, 2, 0, 0);
  const r = planMoveToward("seed", 0, 1, 0, 1, 0, terr, new Set());
  assert.deepEqual(r, { finalPos: { q: 1, r: 0 }, days: 0, arrived: true, log: [] });
});

test("planMoveToward is deterministic for identical inputs", () => {
  const terr = boardRect(-2, 8, -2, 2, "Swamp"); // high lost chance, exercises deviation too
  const a = planMoveToward("trip-seed", 3, 0, 0, 6, 0, terr, new Set());
  const b = planMoveToward("trip-seed", 3, 0, 0, 6, 0, terr, new Set());
  assert.deepEqual(a, b);
});

test("planMoveToward: an all-road trip always arrives with zero lost days and the documented pace", () => {
  const terr = boardRect(-1, 6, 0, 0);
  const roadKeys = new Set();
  for (let q = -1; q <= 6; q++) roadKeys.add(axialKey(q, 0));
  const r = planMoveToward("road-trip", 0, 0, 0, 5, 0, terr, roadKeys);
  assert.equal(r.arrived, true);
  assert.equal(r.finalPos.q, 5);
  assert.equal(r.finalPos.r, 0);
  assert.equal(r.log.length, 5); // 5 hexes crossed, one entry each
  assert.ok(r.log.every((e) => e.lost === false && e.road === true));
  assert.equal(r.days, Math.ceil(5 * daysToCross("Plains", { road: true })));
});

test("planMoveToward reports \"stranded\" when the target is disconnected from the party", () => {
  const terr = new Map([[axialKey(0, 0), "Plains"], [axialKey(20, 20), "Plains"]]);
  const r = planMoveToward("seed", 0, 0, 0, 20, 20, terr, new Set());
  assert.equal(r.arrived, false);
  assert.equal(r.reason, "stranded");
  assert.equal(r.log.length, 0);
  assert.deepEqual(r.finalPos, { q: 0, r: 0 }); // never moved
});

test("planMoveToward: log's day index starts at startDay and increments per hex crossed", () => {
  const terr = boardRect(-1, 6, 0, 0);
  const roadKeys = new Set();
  for (let q = -1; q <= 6; q++) roadKeys.add(axialKey(q, 0));
  const r = planMoveToward("seed", 100, 0, 0, 3, 0, terr, roadKeys);
  assert.deepEqual(r.log.map((e) => e.day), [100, 101, 102]);
});

test("planMoveToward: heavier encumbrance takes longer over the same route", () => {
  const terr = boardRect(-1, 6, 0, 0);
  const roadKeys = new Set();
  for (let q = -1; q <= 6; q++) roadKeys.add(axialKey(q, 0));
  const fast = planMoveToward("enc-seed", 0, 0, 0, 5, 0, terr, roadKeys, { encumbrance: "unencumbered" });
  const slow = planMoveToward("enc-seed", 0, 0, 0, 5, 0, terr, roadKeys, { encumbrance: "heavy" });
  assert.ok(slow.days > fast.days, `expected heavy encumbrance to take longer: ${slow.days} vs ${fast.days}`);
});

test("planMoveToward: at least one sampled trip through high-lost-chance terrain actually gets lost", () => {
  // Swamp, off-road: 3-in-6 lost chance per hex. Sweep several seeds/targets
  // over a long enough leg that at least one should show a genuine deviation.
  const terr = boardRect(-10, 10, -10, 10, "Swamp");
  let sawLost = false;
  for (let i = 0; i < 20 && !sawLost; i++) {
    const r = planMoveToward(`lost-sweep-${i}`, 0, 0, 0, 8, 0, terr, new Set());
    if (r.log.some((e) => e.lost)) sawLost = true;
  }
  assert.ok(sawLost, "expected at least one sampled trip to report a lost day");
});
