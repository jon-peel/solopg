import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRoads, buildManualRoad } from "../js/gen/roads.js";
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
  // A GM-drawn (manual) city–city road; a village sits one hex off its middle.
  const terr = boardRect(-1, 7, -2, 2);
  const existing = [{
    id: "manual:0", manual: true, a: { q: 0, r: 0 }, b: { q: 6, r: 0 }, tier: 1, junction: false,
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

test("computeRoads: three cities at a fair distance all end up connected", () => {
  // The playtest bug: three cities that each had a local road but weren't joined.
  const terr = boardRect(-8, 8, -8, 8);
  const cities = [[0, 0], [7, 0], [3, 6]];
  const roads = computeRoads("s", terr, settlements(cities.map(([q, r]) => [q, r, "City"])), [], []);
  // Build settlement connectivity over the road network and assert one component.
  const onNet = new Set();
  for (const rd of roads) for (const p of rd.path) onNet.add(axialKey(p.q, p.r));
  for (const [q, r] of cities) assert.ok(onNet.has(axialKey(q, r)), `city ${q},${r} has a road`);
  // n cities -> a spanning tree has n-1 edges; assert every city reaches every other.
  const parent = new Map(cities.map(([q, r]) => [axialKey(q, r), axialKey(q, r)]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const rd of roads) {
    const a = axialKey(rd.a.q, rd.a.r), b = axialKey(rd.b.q, rd.b.r);
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  }
  const roots = new Set([...parent.keys()].map(find));
  assert.equal(roots.size, 1, "all three cities are in one connected network");
});

test("computeRoads: idempotent/deterministic; manual roads kept verbatim", () => {
  const terr = boardRect(-1, 9, -3, 3);
  const setl = settlements([[0, 0, "City"], [5, 0, "City"], [8, 2, "Town"]]);
  const first = computeRoads("s", terr, setl, [], []);
  assert.deepEqual(computeRoads("s", terr, setl, [], first), first, "re-derives identically (auto network is a pure function)");
  const manual = { id: "manual:0", manual: true, a: { q: 0, r: -2 }, b: { q: 3, r: -2 }, tier: 2, junction: false, path: [{ q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 }, { q: 3, r: -2 }] };
  const withManual = computeRoads("s", terr, setl, [], [manual]);
  assert.ok(withManual.includes(manual), "a GM-drawn manual road is kept verbatim");
});

test("computeRoads: a newly-revealed town joins the network", () => {
  const terr = boardRect(-1, 12, -3, 3);
  const first = computeRoads("s", terr, settlements([[0, 0, "City"], [5, 0, "City"]]), [], []);
  assert.equal(first.length, 1);
  const grown = computeRoads("s", terr, settlements([[0, 0, "City"], [5, 0, "City"], [9, 0, "Town"]]), [], first);
  const onNet = new Set();
  for (const rd of grown) for (const p of rd.path) onNet.add(axialKey(p.q, p.r));
  assert.ok(onNet.has(axialKey(9, 0)), "the new town is on the network");
  assert.ok(onNet.has(axialKey(0, 0)) && onNet.has(axialKey(5, 0)), "the original cities stay connected");
});

test("computeRoads: nearby routes merge onto a shared corridor instead of paralleling", () => {
  // A manual trunk with two villages stacked below q=3; the lower one's route to
  // the trunk should reuse the upper one's road rather than draw a parallel line.
  const terr = boardRect(-1, 7, -1, 6);
  const manual = { id: "manual:0", manual: true, a: { q: 0, r: 0 }, b: { q: 6, r: 0 }, tier: 2, junction: false, path: [0, 1, 2, 3, 4, 5, 6].map((q) => ({ q, r: 0 })) };
  const setl = settlements([[0, 0, "City"], [6, 0, "City"], [3, 3, "Village"], [3, 5, "Village"]]);
  let tries = 0, merged = 0;
  for (let i = 0; i < 24; i++) {
    const roads = computeRoads("m" + i, terr, setl, [], [manual]);
    const use = new Map(); // auto-road hex -> how many auto roads use it
    for (const rd of roads) { if (rd.manual) continue; for (const p of rd.path) { const k = axialKey(p.q, p.r); use.set(k, (use.get(k) || 0) + 1); } }
    const low = roads.find((r) => r.a.q === 3 && r.a.r === 5);
    if (low) { tries++; if ([...use.values()].some((v) => v >= 2)) merged++; }
  }
  assert.ok(tries > 0, "the lower village built a road");
  assert.ok(merged >= Math.floor(tries * 0.7), `nearby routes share hexes most of the time (${merged}/${tries})`);
});

test("buildManualRoad: a GM-drawn road is kept verbatim and seeds the auto network", () => {
  const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const road = buildManualRoad("manual:0", path);
  assert.equal(road.manual, true);
  assert.equal(road.tier, 2);
  assert.deepEqual(road.a, { q: 0, r: 0 });
  assert.deepEqual(road.b, { q: 3, r: 0 });
  assert.equal(road.path.length, 4);
  // A village beside the drawn road spurs onto it (the manual road is on the network).
  const terr = boardRect(-1, 4, -2, 2);
  const roads = computeRoads("s", terr, settlements([[1, 1, "Village"]]), [], [road]);
  assert.ok(roads.includes(road), "manual road kept verbatim");
  const spur = roads.find((r) => r.a.q === 1 && r.a.r === 1);
  assert.ok(spur && spur.junction, "the village spurs onto the manual road at a crossroad");
});

test("computeRoads: a central city becomes a hub with several roads", () => {
  const terr = boardRect(-4, 4, -4, 4);
  const setl = settlements([[0, 0, "City"], [3, 0, "Town"], [-3, 0, "Town"], [0, 3, "Town"], [0, -3, "Town"]]);
  const roads = computeRoads("s", terr, setl, [], []);
  assert.ok(touches(roads, 0, 0) >= 2, `the central city has multiple roads, got ${touches(roads, 0, 0)}`);
});
