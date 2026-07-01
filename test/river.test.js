import { test } from "node:test";
import assert from "node:assert/strict";
import { biomeAt, elevationAt } from "../js/gen/biome.js";
import { isRiverSource, downhillDirection, riverStateAt } from "../js/gen/river.js";

const NEIGHBOR_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const FLOW_OCTAVES = 1; // must match river.js's own constant

// Scan a grid for the first coordinate matching a predicate — used instead of
// hardcoded literals so these tests stay valid if the noise constants ever
// shift (matches the scanning approach terrain-coherence.test.js already uses
// for sea contagion).
function findCoord(seed, predicate, { qMax = 60, rMax = 60 } = {}) {
  for (let q = -qMax; q <= qMax; q++) {
    for (let r = -rMax; r <= rMax; r++) {
      if (predicate(q, r)) return { q, r };
    }
  }
  return null;
}

test("isRiverSource: never true off Mountains, regardless of position", () => {
  for (let q = -20; q <= 20; q += 4) {
    for (let r = -20; r <= 20; r += 4) {
      const { terrain, elevation } = biomeAt("seed", q, r);
      if (terrain !== "Mountains") {
        assert.equal(isRiverSource("seed", q, r, terrain, elevation), false);
      }
    }
  }
});

test("isRiverSource: deterministic — same inputs always give the same answer", () => {
  const spot = findCoord("seed", (q, r) => biomeAt("seed", q, r).terrain === "Mountains");
  assert.ok(spot, "expected at least one Mountains hex in the scanned range");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  const a = isRiverSource("seed", spot.q, spot.r, terrain, elevation);
  const b = isRiverSource("seed", spot.q, spot.r, terrain, elevation);
  assert.equal(a, b);
});

test("isRiverSource: rare among Mountains hexes, not universal — some yes, most no", () => {
  // Scan many seeds' Mountains hexes and confirm the source chance produces
  // variation (not every peak sources a river, but at least some do across
  // enough draws) — matches the "rare and dramatic" density design call.
  let mountainCount = 0, sourceCount = 0;
  for (let s = 0; s < 40; s++) {
    const seed = `river-seed-${s}`;
    for (let q = -15; q <= 15; q += 3) {
      for (let r = -15; r <= 15; r += 3) {
        const { terrain, elevation } = biomeAt(seed, q, r);
        if (terrain !== "Mountains") continue;
        mountainCount++;
        if (isRiverSource(seed, q, r, terrain, elevation)) sourceCount++;
      }
    }
  }
  assert.ok(mountainCount > 20, `expected a reasonable Mountains sample, got ${mountainCount}`);
  assert.ok(sourceCount > 0, "expected at least one river source across many seeds/mountains");
  assert.ok(sourceCount < mountainCount * 0.5, "expected sources to be a small minority of Mountains hexes");
});

test("downhillDirection: always a valid NEIGHBOR_DIRS index (0-5) or -1", () => {
  for (let q = -20; q <= 20; q += 5) {
    for (let r = -20; r <= 20; r += 5) {
      const dir = downhillDirection("seed", q, r);
      assert.ok(dir === -1 || (dir >= 0 && dir <= 5), `unexpected dir ${dir} at (${q},${r})`);
    }
  }
});

test("downhillDirection: deterministic — same (seed,q,r) always gives the same answer", () => {
  assert.equal(downhillDirection("seed", 7, -3), downhillDirection("seed", 7, -3));
});

test("downhillDirection: when it picks a neighbour, that neighbour is genuinely lower (never uphill)", () => {
  let checked = 0;
  for (let q = -20; q <= 20; q += 2) {
    for (let r = -20; r <= 20; r += 2) {
      const dir = downhillDirection("seed", q, r);
      if (dir === -1) continue;
      checked++;
      const here = elevationAt("seed", q, r, FLOW_OCTAVES);
      const [dq, dr] = NEIGHBOR_DIRS[dir];
      const there = elevationAt("seed", q + dq, r + dr, FLOW_OCTAVES);
      assert.ok(there < here, `picked neighbour at (${q + dq},${r + dr}) isn't lower than (${q},${r})`);
    }
  }
  assert.ok(checked > 0, "expected at least one non-depression hex in range");
});

test("downhillDirection: -1 means every neighbour is genuinely >= here (a real depression)", () => {
  let checked = 0;
  for (let q = -20; q <= 20; q += 2) {
    for (let r = -20; r <= 20; r += 2) {
      const dir = downhillDirection("seed", q, r);
      if (dir !== -1) continue;
      checked++;
      const here = elevationAt("seed", q, r, FLOW_OCTAVES);
      for (const [dq, dr] of NEIGHBOR_DIRS) {
        const there = elevationAt("seed", q + dq, r + dr, FLOW_OCTAVES);
        assert.ok(there >= here, `neighbour at (${q + dq},${r + dr}) is lower, dir shouldn't be -1`);
      }
    }
  }
  assert.ok(checked > 0, "expected at least one depression in range");
});

test("riverStateAt: no incoming edges + not a source -> empty state, no lake forced", () => {
  // A Plains hex is never a source (isRiverSource requires Mountains), so
  // with no incoming edges it should always be a no-op.
  const spot = findCoord("seed", (q, r) => biomeAt("seed", q, r).terrain === "Plains");
  assert.ok(spot, "expected a Plains hex in the scanned range");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  const state = riverStateAt("seed", spot.q, spot.r, terrain, elevation, []);
  assert.deepEqual(state, { riverEdges: [], forceLake: false });
});

test("riverStateAt: incoming edges into Sea/Lake terminate the river cleanly (no outgoing edge added)", () => {
  const seaSpot = findCoord("seed", (q, r) => biomeAt("seed", q, r).terrain === "Sea");
  assert.ok(seaSpot, "expected a Sea hex in the scanned range");
  const { terrain, elevation } = biomeAt("seed", seaSpot.q, seaSpot.r);
  const state = riverStateAt("seed", seaSpot.q, seaSpot.r, terrain, elevation, [2, 4]);
  assert.deepEqual(state.riverEdges, [2, 4]);
  assert.equal(state.forceLake, false);
});

test("riverStateAt: incoming edges onto dry land add exactly one outgoing edge (unless it's a depression)", () => {
  // Find a land hex with a real downhill direction (not a depression).
  const spot = findCoord("seed", (q, r) => {
    const { terrain } = biomeAt("seed", q, r);
    return terrain !== "Sea" && terrain !== "Lake" && downhillDirection("seed", q, r) !== -1;
  });
  assert.ok(spot, "expected a land hex with a real downhill neighbour");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  const outDir = downhillDirection("seed", spot.q, spot.r);
  const state = riverStateAt("seed", spot.q, spot.r, terrain, elevation, [1]);
  assert.deepEqual(state.riverEdges, [1, outDir]);
  assert.equal(state.forceLake, false);
});

test("riverStateAt: a landlocked depression with an incoming river forces a Lake", () => {
  // Find a real coordinate where every neighbour is uphill (downhillDirection
  // returns -1) — a genuine depression, not a hardcoded literal.
  const spot = findCoord("seed", (q, r) => {
    const { terrain } = biomeAt("seed", q, r);
    return terrain !== "Sea" && terrain !== "Lake" && downhillDirection("seed", q, r) === -1;
  });
  assert.ok(spot, "expected at least one depression in the scanned range");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  const state = riverStateAt("seed", spot.q, spot.r, terrain, elevation, [3]);
  assert.deepEqual(state.riverEdges, [3]); // keeps the incoming edge, no outgoing
  assert.equal(state.forceLake, true);
});

test("riverStateAt: a qualifying Mountains source with no incoming edges gets exactly one outgoing edge", () => {
  const spot = findCoord("seed", (q, r) => {
    const { terrain, elevation } = biomeAt("seed", q, r);
    return terrain === "Mountains" && isRiverSource("seed", q, r, terrain, elevation);
  }, { qMax: 100, rMax: 100 });
  assert.ok(spot, "expected at least one river source in the scanned range");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  const outDir = downhillDirection("seed", spot.q, spot.r);
  const state = riverStateAt("seed", spot.q, spot.r, terrain, elevation, []);
  if (outDir === -1) {
    assert.deepEqual(state.riverEdges, []);
    assert.equal(state.forceLake, true);
  } else {
    assert.deepEqual(state.riverEdges, [outDir]);
    assert.equal(state.forceLake, false);
  }
});

test("riverStateAt: deterministic — same inputs always give the same result", () => {
  const a = riverStateAt("seed", 12, -8, "Mountains", 0.9, []);
  const b = riverStateAt("seed", 12, -8, "Mountains", 0.9, []);
  assert.deepEqual(a, b);
});
