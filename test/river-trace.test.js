import { test } from "node:test";
import assert from "node:assert/strict";
import { biomeAt, isWaterAt } from "../js/gen/biome.js";
import { isRiverSource } from "../js/gen/river.js";
import { traceRiverToSea, riverId } from "../js/gen/river-trace.js";
import { axialDistance } from "../js/core/hexgeo.js";

const NEIGHBOR_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Find every river source in a disc around the origin for a seed.
function sourcesIn(seed, radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (axialDistance(0, 0, q, r) > radius) continue;
      const { terrain, elevation } = biomeAt(seed, q, r);
      if (isRiverSource(seed, q, r, terrain, elevation)) out.push({ q, r });
    }
  }
  return out;
}

function consecutiveAreNeighbours(path) {
  for (let i = 1; i < path.length; i++) {
    if (axialDistance(path[i - 1].q, path[i - 1].r, path[i].q, path[i].r) !== 1) return false;
  }
  return true;
}

test("traceRiverToSea: the path is a connected chain of adjacent hexes, source first", () => {
  const seed = "trace-a";
  const sources = sourcesIn(seed, 40);
  assert.ok(sources.length > 0, "expected at least one source");
  for (const s of sources.slice(0, 10)) {
    const { path } = traceRiverToSea(seed, s.q, s.r);
    assert.ok(path.length >= 1, "path must be non-empty");
    assert.equal(path[0].q, s.q);
    assert.equal(path[0].r, s.r);
    assert.ok(consecutiveAreNeighbours(path), `path from (${s.q},${s.r}) has a non-adjacent step`);
  }
});

test("traceRiverToSea: terminates on a WATER hex (Sea or Lake), and only there", () => {
  // Every source's trace should end at a water body (the whole point) and end
  // ON a water hex — never routing through water and back onto land.
  let total = 0, reached = 0;
  for (let s = 0; s < 6; s++) {
    const seed = `trace-reach-${s}`;
    for (const src of sourcesIn(seed, 40)) {
      total++;
      const res = traceRiverToSea(seed, src.q, src.r);
      if (res.reachedWater) {
        reached++;
        const end = res.path[res.path.length - 1];
        assert.ok(isWaterAt(seed, end.q, end.r), "a reached-water river must end on a water hex");
      }
    }
  }
  assert.ok(total > 0, "expected sources across the sampled seeds");
  assert.ok(reached / total > 0.95, `expected >95% of rivers to reach water, got ${reached}/${total}`);
});

test("traceRiverToSea: deterministic — same (seed, source) yields an identical path", () => {
  const seed = "trace-det";
  const [s] = sourcesIn(seed, 40);
  assert.ok(s, "expected a source");
  const a = traceRiverToSea(seed, s.q, s.r);
  const b = traceRiverToSea(seed, s.q, s.r);
  assert.deepEqual(a, b);
});

test("traceRiverToSea: the river runs over land until it meets water — no interior water hex (the through-water bug)", () => {
  const seed = "trace-land";
  const sources = sourcesIn(seed, 40);
  for (const s of sources.slice(0, 12)) {
    const { path, reachedWater } = traceRiverToSea(seed, s.q, s.r);
    if (!reachedWater) continue;
    // Interior hexes (everything but the mouth) must be land — a Mountains
    // source never starts in water, so no hex before the terminus is water.
    // (Lake sources cross their own lake, so skip those for this check.)
    if (isWaterAt(seed, path[0].q, path[0].r)) continue;
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isWaterAt(seed, path[i].q, path[i].r), false,
        `interior hex (${path[i].q},${path[i].r}) should be land, not water`);
    }
  }
});

test("traceRiverToSea: a `claimed` confluence terminates the trace early (tributary joins a trunk)", () => {
  const seed = "trace-merge";
  // Pick a source with a reasonably long path so there's a midpoint to claim.
  let s = null, full = null;
  for (const cand of sourcesIn(seed, 40)) {
    const t = traceRiverToSea(seed, cand.q, cand.r);
    if (t.path.length > 6) { s = cand; full = t; break; }
  }
  assert.ok(s && full, "expected a source with a long enough path");
  // Claim a hex partway down the full path; a re-trace must stop there.
  const cut = full.path[Math.floor(full.path.length / 2)];
  const claimed = new Set([`${cut.q},${cut.r}`]);
  const joinedTrace = traceRiverToSea(seed, s.q, s.r, { claimed });
  assert.equal(joinedTrace.joined, true, "should report joining the claimed trunk");
  assert.equal(joinedTrace.reachedWater, false, "a joined trace didn't itself reach water");
  const end = joinedTrace.path[joinedTrace.path.length - 1];
  assert.ok(claimed.has(`${end.q},${end.r}`), "the trace must terminate on the claimed confluence hex");
  assert.ok(joinedTrace.path.length < full.path.length, "joining shortens the path vs the full run");
});

test("riverId: stable, coordinate-keyed", () => {
  assert.equal(riverId(3, -4), "river:3,-4");
  assert.equal(riverId(3, -4), riverId(3, -4));
  assert.notEqual(riverId(3, -4), riverId(-4, 3));
});
