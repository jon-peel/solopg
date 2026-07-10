import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAVEL_COST, ROAD_PACE_MULTIPLIER, ENCUMBRANCE_FACTOR, paceFor, daysToCross,
  LOST_CHANCE, rollGetLost, deviateDirection,
  roadHexKeySet, planRoute, travelDayToward, travelDayBearing,
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

test("travelDayToward: already at the target arrives immediately, no day spent", () => {
  const terr = boardRect(0, 2, 0, 0);
  const r = travelDayToward("seed", 0, 1, 0, 1, 0, terr, new Set());
  assert.deepEqual(r, { finalPos: { q: 1, r: 0 }, hexesCrossed: 0, daySpent: false, arrived: true, log: [] });
});

test("travelDayToward: one day of open Plains covers several hexes (pace 4/day)", () => {
  const terr = boardRect(-1, 12, -1, 1); // far target so the day's budget is the limit, not arrival
  const r = travelDayToward("seed", 0, 0, 0, 11, 0, terr, new Set());
  assert.equal(r.daySpent, true);
  assert.equal(r.arrived, false); // 11 hexes away, one day only gets partway
  assert.equal(r.hexesCrossed, 4); // Plains: 4 hexes/day
  assert.equal(r.log.length, 4);
});

test("travelDayToward: one day of Mountains covers a single hex (at-least-one rule)", () => {
  const terr = boardRect(-1, 12, -1, 1, "Mountains");
  const r = travelDayToward("seed", 0, 0, 0, 11, 0, terr, new Set());
  assert.equal(r.hexesCrossed, 1);
  assert.equal(r.daySpent, true);
});

test("travelDayToward: a road day covers more ground than off-road (8/day vs 4)", () => {
  const terr = boardRect(-1, 20, -1, 1);
  const roadKeys = new Set();
  for (let q = -1; q <= 20; q++) roadKeys.add(axialKey(q, 0));
  const offRoad = travelDayToward("seed", 0, 0, 0, 19, 0, terr, new Set());
  const onRoad = travelDayToward("seed", 0, 0, 0, 19, 0, terr, roadKeys);
  assert.equal(offRoad.hexesCrossed, 4);
  assert.equal(onRoad.hexesCrossed, 8);
  assert.ok(onRoad.log.every((e) => e.road === true && e.lost === false)); // roads never get lost
});

test("travelDayToward: heavier encumbrance covers fewer hexes in a day", () => {
  const terr = boardRect(-1, 12, -1, 1);
  const fast = travelDayToward("seed", 0, 0, 0, 11, 0, terr, new Set(), { encumbrance: "unencumbered" });
  const slow = travelDayToward("seed", 0, 0, 0, 11, 0, terr, new Set(), { encumbrance: "heavy" });
  assert.ok(slow.hexesCrossed < fast.hexesCrossed, `${slow.hexesCrossed} should be < ${fast.hexesCrossed}`);
});

test("travelDayToward: arriving mid-day ends the trip early", () => {
  const terr = boardRect(-1, 5, -1, 1); // target only 2 hexes away on Plains (budget allows 4)
  const r = travelDayToward("seed", 0, 0, 0, 2, 0, terr, new Set());
  assert.equal(r.arrived, true);
  assert.deepEqual(r.finalPos, { q: 2, r: 0 });
  assert.equal(r.hexesCrossed, 2);
});

test("travelDayToward is deterministic for identical inputs", () => {
  const terr = boardRect(-4, 12, -4, 4, "Swamp"); // high lost chance exercises deviation
  const a = travelDayToward("trip-seed", 3, 0, 0, 8, 0, terr, new Set());
  const b = travelDayToward("trip-seed", 3, 0, 0, 8, 0, terr, new Set());
  assert.deepEqual(a, b);
});

test("travelDayToward reports \"stranded\" (no day spent) when the target is disconnected", () => {
  const terr = new Map([[axialKey(0, 0), "Plains"], [axialKey(20, 20), "Plains"]]);
  const r = travelDayToward("seed", 0, 0, 0, 20, 20, terr, new Set());
  assert.equal(r.arrived, false);
  assert.equal(r.reason, "stranded");
  assert.equal(r.daySpent, false);
  assert.deepEqual(r.finalPos, { q: 0, r: 0 });
});

test("travelDayBearing: steps a fixed direction, generating frontier terrain via the callback", () => {
  const store = new Map();
  const generated = [];
  const terrainAt = (q, r) => {
    const k = axialKey(q, r);
    if (!store.has(k)) { store.set(k, "Plains"); generated.push(k); }
    return store.get(k);
  };
  // dir 0 = E ([1,0]); a Plains day covers 4 hexes. (Exact final position isn't
  // asserted — a Plains lost roll can bend the path — only that a full day's
  // worth of hexes were crossed and generated on the frontier.)
  const r = travelDayBearing("seed", 0, 0, 0, 0, { terrainAt });
  assert.equal(r.hexesCrossed, 4);
  assert.ok(generated.length >= 4, "walked into and generated new frontier hexes");
});

test("travelDayBearing: a straight (unlost) Plains bearing ends due east", () => {
  // Pick a seed whose first days don't roll lost, to pin the straight-line case.
  const terrainAt = () => "Plains";
  let straight = null;
  for (let i = 0; i < 40 && !straight; i++) {
    const r = travelDayBearing(`straight-${i}`, 0, 0, 0, 0, { terrainAt });
    if (r.log.every((e) => !e.lost)) straight = r;
  }
  assert.ok(straight, "expected to find a seed with no lost roll");
  assert.deepEqual(straight.finalPos, { q: 4, r: 0 }); // 4 hexes due east
});

test("travelDayBearing: a bearing into water is blocked with no day spent", () => {
  // Everything Sea (impassable). The party can't set out.
  const terrainAt = () => "Sea";
  const r = travelDayBearing("seed", 0, 0, 0, 0, { terrainAt });
  assert.equal(r.reason, "blocked");
  assert.equal(r.daySpent, false);
  assert.equal(r.hexesCrossed, 0);
});

test("travelDayBearing: getting lost bends the day's path off the straight bearing", () => {
  // Swamp (3-in-6 lost). Sweep seeds until one day shows a deviation, and
  // confirm at least one crossed hex is off the straight E line (r !== 0).
  const terrainAt = () => "Swamp";
  let sawBend = false;
  for (let i = 0; i < 30 && !sawBend; i++) {
    const r = travelDayBearing(`bend-${i}`, 0, 0, 0, 0, { terrainAt });
    if (r.log.some((e) => e.lost) && r.log.some((e) => e.r !== 0)) sawBend = true;
  }
  assert.ok(sawBend, "expected at least one sampled bearing-day to bend off course");
});

// --- N/S bearings: alternate the flanking hexes, net a straight vertical course.
// A pointy-top hex has no true N/S neighbour, so N zig-zags NE/NW and S zig-zags
// SE/SW. Pixel x ∝ (q + r/2), so a straight vertical course keeps |q + r/2| small.

test("travelDayBearing N: an unlost day alternates NE/NW and nets straight north", () => {
  const terrainAt = () => "Plains";
  let straight = null;
  for (let i = 0; i < 40 && !straight; i++) {
    const r = travelDayBearing(`n-${i}`, 0, 0, 0, "N", { terrainAt });
    if (r.log.every((e) => !e.lost)) straight = r;
  }
  assert.ok(straight, "expected a seed with no lost roll");
  // every step went north (r decreased by 1) via a NE or NW flank
  assert.ok(straight.log.every((e) => e.dir === 1 || e.dir === 2), "only NE/NW flanks");
  assert.equal(straight.finalPos.r, -straight.hexesCrossed);
  assert.ok(Math.abs(straight.finalPos.q + straight.finalPos.r / 2) <= 0.5, "stays on the north column");
  if (straight.hexesCrossed > 1) {
    assert.ok(
      straight.log.some((e) => e.dir === 1) && straight.log.some((e) => e.dir === 2),
      "actually alternated NE and NW",
    );
  }
});

test("travelDayBearing S: an unlost day alternates SE/SW and nets straight south", () => {
  const terrainAt = () => "Plains";
  let straight = null;
  for (let i = 0; i < 40 && !straight; i++) {
    const r = travelDayBearing(`s-${i}`, 0, 0, 0, "S", { terrainAt });
    if (r.log.every((e) => !e.lost)) straight = r;
  }
  assert.ok(straight, "expected a seed with no lost roll");
  assert.ok(straight.log.every((e) => e.dir === 4 || e.dir === 5), "only SW/SE flanks");
  assert.equal(straight.finalPos.r, straight.hexesCrossed);
  assert.ok(Math.abs(straight.finalPos.q + straight.finalPos.r / 2) <= 0.5, "stays on the south column");
  if (straight.hexesCrossed > 1) {
    assert.ok(
      straight.log.some((e) => e.dir === 4) && straight.log.some((e) => e.dir === 5),
      "actually alternated SW and SE",
    );
  }
});

test("travelDayBearing N: the flank alternation is stateless across day-presses (continues straight)", () => {
  const terrainAt = () => "Plains";
  // Walk north over two consecutive presses; the second continues from where
  // the first ended and should stay on the same column (row-parity keyed).
  const day1 = travelDayBearing("cont", 0, 0, 0, "N", { terrainAt });
  const p = day1.finalPos;
  const day2 = travelDayBearing("cont", 1, p.q, p.r, "N", { terrainAt });
  // If neither day got lost, the combined course is still vertical.
  if (day1.log.every((e) => !e.lost) && day2.log.every((e) => !e.lost)) {
    assert.ok(Math.abs(day2.finalPos.q + day2.finalPos.r / 2) <= 0.5, "still on the north column after two presses");
  }
  // The second day's first flank is chosen purely from the row it starts on,
  // not a carried counter — so it depends only on p.r's parity.
  assert.equal(day2.log[0].dir, (p.r & 1) === 0 ? 1 : 2);
});
