import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRoads } from "../js/gen/roads.js";
import { axialKey } from "../js/core/hexgeo.js";

// A filled axial box of one terrain, with per-hex overrides (keyed by axialKey).
function boardRect(qMin, qMax, rMin, rMax, terrain = "Plains", overrides = {}) {
  const t = new Map();
  for (let q = qMin; q <= qMax; q++) for (let r = rMin; r <= rMax; r++) t.set(axialKey(q, r), terrain);
  for (const [k, v] of Object.entries(overrides)) t.set(k, v);
  return t;
}
function settlements(list) { // list of [q, r, size]
  const m = new Map();
  for (const [q, r, size] of list) m.set(axialKey(q, r), size);
  return m;
}
const onPath = (path, q, r) => path.some((p) => p.q === q && p.r === r);
const touches = (roads, q, r) => roads.filter((rd) => onPath(rd.path, q, r)).length;

test("computeRoads: two nearby cities connect with one highway", () => {
  const terr = boardRect(-1, 6, -1, 1);
  const roads = computeRoads("s", terr, settlements([[0, 0, "City"], [5, 0, "City"]]), [], []);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].tier, 1, "a city-owned road is a highway");
  const ep = new Set([axialKey(roads[0].a.q, roads[0].a.r), axialKey(roads[0].b.q, roads[0].b.r)]);
  assert.ok(ep.has(axialKey(0, 0)) && ep.has(axialKey(5, 0)), "connects the two cities");
});

test("computeRoads: cities wire up across a long open-plains distance", () => {
  const terr = boardRect(-1, 26, -1, 1);
  const roads = computeRoads("s", terr, settlements([[0, 0, "City"], [25, 0, "City"]]), [], []);
  assert.equal(roads.length, 1, "a highway can span the map between two cities");
});

test("computeRoads: a village spurs to the nearest road at a crossroad (tier 3, junction)", () => {
  // A pre-built city–city road; a village sits one hex off its middle.
  const terr = boardRect(-1, 7, -2, 2);
  const existing = [{
    id: "road:0,0", a: { q: 0, r: 0 }, b: { q: 6, r: 0 }, tier: 1, junction: false,
    path: [0, 1, 2, 3, 4, 5, 6].map((q) => ({ q, r: 0 })),
  }];
  const setl = settlements([[0, 0, "City"], [6, 0, "City"], [3, 1, "Village"]]);
  let built = 0, wrong = 0;
  for (let i = 0; i < 24; i++) {
    const roads = computeRoads("v" + i, terr, setl, [], existing);
    const spur = roads.find((r) => r.a.q === 3 && r.a.r === 1);
    if (spur) {
      built++;
      // joins the road (a nearby r=0 hex), not a far city, as a tier-3 crossroad
      const onRoad = spur.b.r === 0 && spur.b.q >= 0 && spur.b.q <= 6;
      if (spur.tier !== 3 || !spur.junction || !onRoad) wrong++;
    }
  }
  assert.ok(built >= 18, `village usually spurs to the road, built ${built}/24`);
  assert.equal(wrong, 0, "every spur is a tier-3 crossroad onto the road");
});

test("computeRoads: roads never cross water (unreachable -> no road)", () => {
  const terr = boardRect(-1, 5, -3, 3, "Plains");
  for (let r = -3; r <= 3; r++) terr.set(axialKey(2, r), "Sea"); // a full sea column separates them
  const roads = computeRoads("s", terr, settlements([[0, 0, "City"], [4, 0, "City"]]), [], []);
  assert.equal(roads.length, 0);
});

test("computeRoads: a short mountain nub is routed AROUND, not through", () => {
  const terr = boardRect(-1, 5, -2, 2, "Plains", {
    [axialKey(2, 0)]: "Mountains",
    [axialKey(2, -1)]: "Mountains",
  });
  const roads = computeRoads("s", terr, settlements([[0, 0, "City"], [4, 0, "City"]]), [], []);
  assert.equal(roads.length, 1);
  assert.ok(!onPath(roads[0].path, 2, 0) && !onPath(roads[0].path, 2, -1), "route avoids the mountain nub");
});

test("computeRoads: remote small settlements stay roadless (reach cap)", () => {
  const terr = boardRect(-1, 12, -1, 1);
  // two hamlets 11 hexes apart, well beyond a Hamlet's reach
  const roads = computeRoads("s", terr, settlements([[0, 0, "Hamlet"], [11, 0, "Hamlet"]]), [], []);
  assert.equal(roads.length, 0);
});

test("computeRoads: nearby hamlets usually get a track between them", () => {
  const terr = boardRect(-1, 5, -1, 1);
  const setl = settlements([[0, 0, "Hamlet"], [3, 0, "Hamlet"]]);
  let built = 0;
  for (let i = 0; i < 24; i++) if (computeRoads("h" + i, terr, setl, [], []).length > 0) built++;
  assert.ok(built >= 16, `nearby hamlets usually connect, built ${built}/24`);
});

test("computeRoads: a road hugs a river valley (discount tips an otherwise-equal choice)", () => {
  const terr = boardRect(-1, 3, -4, 2, "Plains");
  const rivers = [{ path: [{ q: 1, r: -2 }, { q: 1, r: -3 }] }]; // discounts (1,-1), not (1,0)
  const roads = computeRoads("s", terr, settlements([[0, 0, "City"], [2, -1, "City"]]), rivers, []);
  assert.equal(roads.length, 1);
  assert.ok(onPath(roads[0].path, 1, -1), "route takes the river-adjacent hex");
  assert.ok(!onPath(roads[0].path, 1, 0), "route avoids the non-valley hex");
});

test("computeRoads: append-only, idempotent, and deterministic", () => {
  const terr = boardRect(-1, 9, -3, 3);
  const setl = settlements([[0, 0, "City"], [5, 0, "City"], [8, 2, "Town"]]);
  const first = computeRoads("s", terr, setl, [], []);
  assert.deepEqual(computeRoads("s", terr, setl, [], []), first, "same inputs -> identical roads");
  const again = computeRoads("s", terr, setl, [], first);
  assert.equal(again.length, first.length, "re-run adds no roads (all settlements on-net)");
  for (const r of first) assert.ok(again.includes(r), "existing road kept verbatim (same object)");
});

test("computeRoads: a newly-revealed town extends the network without moving old roads", () => {
  const terr = boardRect(-1, 12, -3, 3);
  const first = computeRoads("s", terr, settlements([[0, 0, "City"], [5, 0, "City"]]), [], []);
  assert.equal(first.length, 1);
  const grown = settlements([[0, 0, "City"], [5, 0, "City"], [9, 0, "Town"]]);
  const roads = computeRoads("s", terr, grown, [], first);
  assert.ok(roads.length > first.length, "the new town adds a road");
  for (const r of first) assert.ok(roads.includes(r), "the original road is kept verbatim");
});

test("computeRoads: a central city becomes a hub with several roads", () => {
  const terr = boardRect(-4, 4, -4, 4);
  const setl = settlements([[0, 0, "City"], [3, 0, "Town"], [-3, 0, "Town"], [0, 3, "Town"], [0, -3, "Town"]]);
  const roads = computeRoads("s", terr, setl, [], []);
  assert.ok(touches(roads, 0, 0) >= 2, `the central city has multiple roads, got ${touches(roads, 0, 0)}`);
});
