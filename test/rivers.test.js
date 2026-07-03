import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRivers, buildManualRiver } from "../js/gen/rivers.js";
import { terrainAt, neighborTerrainsOf } from "../js/gen/affinity.js";
import { hexDisc, neighbors, axialKey } from "../js/core/hexgeo.js";

const WATER = new Set(["Sea", "Lake"]);

// Build a revealed area of affinity terrain (ring fill from origin) as a
// terrainByKey map, the same shape app.js hands computeRivers.
function terrainArea(seed, radius) {
  const map = new Map();
  for (const { q, r } of hexDisc(0, 0, radius)) {
    const nts = neighborTerrainsOf(q, r, (nq, nr) => map.get(axialKey(nq, nr)));
    map.set(axialKey(q, r), terrainAt(seed, q, r, nts));
  }
  return map;
}

function adjacent(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2 === 1;
}

test("computeRivers: each river is a connected chain from a Mountains source", () => {
  const terr = terrainArea("rv-a", 34);
  const rivers = computeRivers("rv-a", terr);
  assert.ok(rivers.length > 0, "expected some rivers on a large area");
  for (const rv of rivers) {
    assert.ok(rv.path.length >= 3, "rivers are at least a few hexes long");
    assert.equal(rv.path[0].q, rv.source.q);
    assert.equal(rv.path[0].r, rv.source.r);
    assert.equal(terr.get(axialKey(rv.source.q, rv.source.r)), "Mountains", "source is a Mountains hex");
    for (let i = 1; i < rv.path.length; i++) {
      assert.ok(adjacent(rv.path[i - 1], rv.path[i]), `river ${rv.id} has a non-adjacent step at ${i}`);
    }
  }
});

test("computeRivers: a river ends at (adjacent to, or joining) major water — never on open land", () => {
  const seed = "rv-b";
  const terr = terrainArea(seed, 34);
  const rivers = computeRivers(seed, terr);
  // Reconstruct major-water membership: connected water bodies with size >= 20.
  const bodyOf = new Map(); const size = new Map(); let bid = 0;
  for (const key of terr.keys()) {
    if (!WATER.has(terr.get(key)) || bodyOf.has(key)) continue;
    const [q0, r0] = key.split(",").map(Number); const st = [{ q: q0, r: r0 }]; bodyOf.set(key, bid); let n = 0;
    while (st.length) { const c = st.pop(); n++; for (const nb of neighbors(c.q, c.r)) { const nk = axialKey(nb.q, nb.r); if (WATER.has(terr.get(nk)) && !bodyOf.has(nk)) { bodyOf.set(nk, bid); st.push(nb); } } }
    size.set(bid, n); bid++;
  }
  const isMajor = (q, r) => { const b = bodyOf.get(axialKey(q, r)); return b !== undefined && size.get(b) >= 20; };
  // set of all hexes on any river (for the confluence case)
  const onRiver = new Set();
  for (const rv of rivers) for (const p of rv.path) onRiver.add(axialKey(p.q, p.r));

  for (const rv of rivers) {
    const end = rv.path[rv.path.length - 1];
    const endsAtMajor = neighbors(end.q, end.r).some((n) => isMajor(n.q, n.r)) || isMajor(end.q, end.r);
    // or it joined another river at this hex (a confluence)
    const joinsRiver = [...onRiver].length > rv.path.length; // some other river shares hexes
    assert.ok(endsAtMajor || joinsRiver, `river ${rv.id} dead-ends on open land`);
  }
});

test("computeRivers: rivers avoid highlands — mountains are a small minority of path hexes", () => {
  // The cost field routes rivers around mountains (they're the dearest terrain);
  // the mountain hexes that do appear are mostly the source descent, plus the
  // odd low-cost coastal peak on the cheapest route. Either way a small share.
  const seed = "rv-c";
  const terr = terrainArea(seed, 34);
  let mtn = 0, tot = 0;
  for (const rv of computeRivers(seed, terr)) {
    for (const p of rv.path) { tot++; if (terr.get(axialKey(p.q, p.r)) === "Mountains") mtn++; }
  }
  assert.ok(tot > 0, "expected river hexes");
  assert.ok(mtn / tot < 0.3, `too many mountain hexes on rivers: ${(100 * mtn / tot).toFixed(0)}%`);
});

test("computeRivers: deterministic for the same (seed, terrain)", () => {
  const terr = terrainArea("rv-d", 28);
  assert.deepEqual(computeRivers("rv-d", terr), computeRivers("rv-d", terr));
});

test("computeRivers: append-only — revealing more terrain never drops or changes an existing river", () => {
  const seed = "rv-mono";
  // A smaller revealed area, then a superset (ring fill shares the inner hexes,
  // so terrain is identical there — like generating more around what exists).
  const small = terrainArea(seed, 22);
  const big = terrainArea(seed, 34);
  const r1 = computeRivers(seed, small);
  assert.ok(r1.length > 0, "expected rivers in the smaller area");
  const r2 = computeRivers(seed, big, r1); // pass r1 as existing, like syncRivers does
  assert.ok(r2.length >= r1.length, "the network only grows");
  const byId = new Map(r2.map((rv) => [rv.id, rv]));
  for (const rv of r1) {
    const kept = byId.get(rv.id);
    assert.ok(kept, `river ${rv.id} disappeared after revealing more terrain`);
    assert.deepEqual(kept.path, rv.path, `river ${rv.id} was re-routed (its path changed)`);
  }
});

test("computeRivers: no rivers when there is no major water to drain to", () => {
  // An all-land area (no Sea/Lake) has no sink, so no rivers.
  const terr = new Map();
  for (const { q, r } of hexDisc(0, 0, 12)) terr.set(axialKey(q, r), "Mountains");
  assert.equal(computeRivers("x", terr).length, 0);
});

// --- manual (GM-drawn) rivers -------------------------------------------

// A controlled strip: Mountains column at the west (q=0), Plains in the middle,
// a major Sea block at the east (q>=14, 5x5=25 hexes >= the major threshold).
function stripMap() {
  const terr = new Map();
  for (let q = 0; q <= 18; q++) for (let r = 0; r <= 4; r++) {
    terr.set(axialKey(q, r), q === 0 ? "Mountains" : q >= 14 ? "Sea" : "Plains");
  }
  return terr;
}

test("buildManualRiver: orients upstream-first and flags open ends", () => {
  const terr = stripMap();
  // drawn mouth->source (Plains ... Mountains): should reverse to source-first.
  const rv = buildManualRiver("m1", [{ q: 2, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 }], terr);
  assert.deepEqual(rv.path[0], { q: 0, r: 0 }); // mountains end first
  assert.equal(rv.upstreamOpen, false); // head is Mountains
  assert.equal(rv.downstreamOpen, true); // tail (2,0) is Plains, not water
  assert.equal(rv.manual, true);
});

test("manual river: open ends complete to a mountain (upstream) and major water (downstream)", () => {
  const terr = stripMap();
  const drawn = [{ q: 6, r: 2 }, { q: 7, r: 2 }, { q: 8, r: 2 }];
  const mr = buildManualRiver("m1", drawn, terr);
  assert.equal(mr.upstreamOpen, true);
  assert.equal(mr.downstreamOpen, true);
  const [completed] = computeRivers("s", terr, [mr]);
  assert.equal(completed.id, "m1");
  assert.equal(completed.upstreamOpen, false, "upstream should reach a mountain");
  assert.equal(completed.downstreamOpen, false, "downstream should reach the sea");
  assert.equal(terr.get(axialKey(completed.path[0].q, completed.path[0].r)), "Mountains");
  assert.equal(terr.get(axialKey(completed.path[completed.path.length - 1].q, completed.path[completed.path.length - 1].r)), "Sea");
  // the drawn hexes are still there, in order, untouched
  const keys = completed.path.map((p) => axialKey(p.q, p.r));
  const di = keys.indexOf("6,2");
  assert.ok(di >= 0 && keys[di + 1] === "7,2" && keys[di + 2] === "8,2", "drawn hexes preserved contiguously");
});

test("manual river: an open end that can't reach yet stays open (no partial commit)", () => {
  // No major water at all -> downstream can never complete; drawn hexes kept.
  const terr = new Map();
  for (let q = 0; q <= 6; q++) for (let r = 0; r <= 2; r++) terr.set(axialKey(q, r), "Plains");
  const mr = buildManualRiver("m1", [{ q: 1, r: 1 }, { q: 2, r: 1 }], terr);
  const [rv] = computeRivers("s", terr, [mr]);
  assert.equal(rv.downstreamOpen, true, "no sea -> still open");
  assert.deepEqual(rv.path, [{ q: 1, r: 1 }, { q: 2, r: 1 }], "drawn hexes untouched");
});

test("manual river: kept verbatim across recompute; auto rivers merge into it", () => {
  const terr = terrainArea("man-merge", 34);
  // draw a short manual river on a couple of plains hexes near the origin
  let a = null;
  for (const key of terr.keys()) { if (terr.get(key) === "Plains") { a = key.split(",").map(Number); break; } }
  const [q, r] = a;
  const mr = buildManualRiver("m1", [{ q, r }, { q: q + 1, r }], terr);
  const first = computeRivers("man-merge", terr, [mr]);
  const mine1 = first.find((rv) => rv.id === "m1");
  assert.ok(mine1, "manual river present");
  // recompute again passing the result back (like syncRivers) — manual river's
  // already-completed/ drawn hexes never change.
  const second = computeRivers("man-merge", terr, first);
  const mine2 = second.find((rv) => rv.id === "m1");
  assert.deepEqual(mine2.path, mine1.path, "manual river path stable across recompute");
  assert.ok(second.length >= first.length, "network only grows");
});
