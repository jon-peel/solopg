import { test } from "node:test";
import assert from "node:assert/strict";
import { biomeAt, isOceanAt } from "../js/gen/biome.js";
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

test("traceRiverToSea: reaches the sea, terminating on an ocean hex", () => {
  // Across several seeds, every source's trace should reach the sea (the whole
  // point of the rework) and end ON an ocean hex.
  let total = 0, reached = 0;
  for (let s = 0; s < 6; s++) {
    const seed = `trace-reach-${s}`;
    for (const src of sourcesIn(seed, 40)) {
      total++;
      const res = traceRiverToSea(seed, src.q, src.r);
      if (res.reachedSea) {
        reached++;
        const end = res.path[res.path.length - 1];
        assert.ok(isOceanAt(seed, end.q, end.r), "a reached-sea river must end on an ocean hex");
      }
    }
  }
  assert.ok(total > 0, "expected sources across the sampled seeds");
  // The architecture guarantees ~100%; allow a tiny margin for any budget edge.
  assert.ok(reached / total > 0.95, `expected >95% of rivers to reach the sea, got ${reached}/${total}`);
});

test("traceRiverToSea: deterministic — same (seed, source) yields an identical path", () => {
  const seed = "trace-det";
  const [s] = sourcesIn(seed, 40);
  assert.ok(s, "expected a source");
  const a = traceRiverToSea(seed, s.q, s.r);
  const b = traceRiverToSea(seed, s.q, s.r);
  assert.deepEqual(a, b);
});

test("traceRiverToSea: only the terminating hex is ocean (the river runs over land until it arrives)", () => {
  const seed = "trace-land";
  const sources = sourcesIn(seed, 40);
  for (const s of sources.slice(0, 8)) {
    const { path, reachedSea } = traceRiverToSea(seed, s.q, s.r);
    if (!reachedSea) continue;
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isOceanAt(seed, path[i].q, path[i].r), false,
        `interior hex (${path[i].q},${path[i].r}) should be land, not ocean`);
    }
  }
});

test("riverId: stable, coordinate-keyed", () => {
  assert.equal(riverId(3, -4), "river:3,-4");
  assert.equal(riverId(3, -4), riverId(3, -4));
  assert.notEqual(riverId(3, -4), riverId(-4, 3));
});
