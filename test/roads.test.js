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

test("computeRoads: two nearby cities link with one tier-1 highway", () => {
  const terr = boardRect(-1, 6, -1, 1);
  const setl = settlements([[0, 0, "City"], [5, 0, "City"]]);
  const roads = computeRoads("s", terr, setl, [], []);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].tier, 1);
  const ep = new Set([axialKey(roads[0].a.q, roads[0].a.r), axialKey(roads[0].b.q, roads[0].b.r)]);
  assert.ok(ep.has(axialKey(0, 0)) && ep.has(axialKey(5, 0)), "endpoints are the two cities");
  assert.deepEqual(roads[0].path[0], roads[0].a, "path starts at a");
  assert.deepEqual(roads[0].path[roads[0].path.length - 1], roads[0].b, "path ends at b");
});

test("computeRoads: two cities on open plains link even at a fair distance", () => {
  const terr = boardRect(-1, 11, -1, 1);
  const setl = settlements([[0, 0, "City"], [10, 0, "City"]]); // effDist 10, well under the cap
  const roads = computeRoads("s", terr, setl, [], []);
  assert.equal(roads.length, 1, "open-ground big places connect regardless of a moderate gap");
});

test("computeRoads: cities beyond the max link distance don't connect", () => {
  const terr = boardRect(-1, 19, -1, 1);
  const setl = settlements([[0, 0, "City"], [18, 0, "City"]]); // 18 hexes > MAX_LINK_DIST prefilter
  assert.equal(computeRoads("s", terr, setl, [], []).length, 0);
});

test("computeRoads: two hamlets never anchor a trunk road", () => {
  const terr = boardRect(-1, 6, -1, 1);
  const setl = settlements([[0, 0, "Hamlet"], [3, 0, "Hamlet"]]);
  assert.equal(computeRoads("s", terr, setl, [], []).length, 0);
});

test("computeRoads: a long mountain wall inflates the link past threshold (blocked)", () => {
  // Only the r=0 corridor is placed; the gap is all Mountains -> cutting through is dear.
  const t = new Map();
  for (let q = 0; q <= 4; q++) t.set(axialKey(q, 0), q === 0 || q === 4 ? "Plains" : "Mountains");
  const setl = settlements([[0, 0, "City"], [4, 0, "City"]]);
  assert.equal(computeRoads("s", t, setl, [], []).length, 0);
});

test("computeRoads: a short mountain nub is routed AROUND, not through", () => {
  const terr = boardRect(-1, 5, -2, 2, "Plains", {
    [axialKey(2, 0)]: "Mountains",
    [axialKey(2, -1)]: "Mountains",
  });
  const setl = settlements([[0, 0, "City"], [4, 0, "City"]]);
  const roads = computeRoads("s", terr, setl, [], []);
  assert.equal(roads.length, 1);
  assert.ok(!onPath(roads[0].path, 2, 0) && !onPath(roads[0].path, 2, -1), "route avoids the mountain nub");
});

test("computeRoads: roads never cross water (unreachable -> no road)", () => {
  const terr = boardRect(-1, 5, -3, 3, "Plains");
  for (let r = -3; r <= 3; r++) terr.set(axialKey(2, r), "Sea"); // a full sea column separates them
  const setl = settlements([[0, 0, "City"], [4, 0, "City"]]);
  assert.equal(computeRoads("s", terr, setl, [], []).length, 0);
});

test("computeRoads: a road hugs a river valley (discount tips an otherwise-equal choice)", () => {
  // Two symmetric 2-hop routes from (0,0) to (2,-1): via (1,0) or (1,-1). A river at
  // (1,-2)/(1,-3) discounts (1,-1) only, so the valley route wins.
  const terr = boardRect(-1, 3, -4, 2, "Plains");
  const setl = settlements([[0, 0, "City"], [2, -1, "City"]]);
  const rivers = [{ path: [{ q: 1, r: -2 }, { q: 1, r: -3 }] }];
  const roads = computeRoads("s", terr, setl, rivers, []);
  assert.equal(roads.length, 1);
  assert.ok(onPath(roads[0].path, 1, -1), "route takes the river-adjacent hex");
  assert.ok(!onPath(roads[0].path, 1, 0), "route avoids the non-valley hex");
});

test("computeRoads: append-only, idempotent, and deterministic", () => {
  const terr = boardRect(-1, 9, -3, 3, "Plains");
  const setl = settlements([[0, 0, "City"], [5, 0, "City"], [8, 2, "Town"]]);
  const first = computeRoads("s", terr, setl, [], []);
  assert.deepEqual(computeRoads("s", terr, setl, [], []), first, "same inputs -> identical roads");
  const again = computeRoads("s", terr, setl, [], first);
  assert.equal(again.length, first.length, "re-run adds no roads");
  for (const r of first) assert.ok(again.includes(r), "existing road kept verbatim (same object)");
});

test("computeRoads: a newly-revealed settlement extends the network without moving old roads", () => {
  const terr = boardRect(-1, 12, -3, 3, "Plains");
  const first = computeRoads("s", terr, settlements([[0, 0, "City"], [5, 0, "City"]]), [], []);
  assert.equal(first.length, 1);
  const grown = settlements([[0, 0, "City"], [5, 0, "City"], [9, 0, "City"]]); // (9,0) near (5,0)
  const roads = computeRoads("s", terr, grown, [], first);
  assert.ok(roads.length >= 2, "a new city adds at least one road");
  assert.ok(roads.includes(first[0]), "the original road is kept verbatim");
});

test("computeRoads: three mutually-close cities form a spanning tree, not a mesh", () => {
  const terr = boardRect(-2, 6, -2, 6, "Plains");
  const setl = settlements([[0, 0, "City"], [4, 0, "City"], [2, 3, "City"]]);
  const roads = computeRoads("s", terr, setl, [], []);
  assert.equal(roads.length, 2, "3 nodes -> 2 edges (tree), not 3");
  const onNet = new Set();
  for (const rd of roads) { onNet.add(axialKey(rd.a.q, rd.a.r)); onNet.add(axialKey(rd.b.q, rd.b.r)); }
  assert.equal(onNet.size, 3, "every city is on the network");
});
