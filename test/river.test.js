import { test } from "node:test";
import assert from "node:assert/strict";
import { biomeAt } from "../js/gen/biome.js";
import { isRiverSource } from "../js/gen/river.js";

// Rivers were reworked (Phase 3R.5 "curated rivers"): the per-hex flow model
// (downhillDirection / riverStateAt / lake-overflow) was retired in favour of
// tracing each source to the sea up front (see test/river-trace.test.js). What
// remains in river.js is SOURCE DETECTION, tested here.

// Scan a grid for the first coordinate matching a predicate — used instead of
// hardcoded literals so these tests stay valid if the noise constants ever
// shift.
function findCoord(seed, predicate, { qMax = 60, rMax = 60 } = {}) {
  for (let q = -qMax; q <= qMax; q++) {
    for (let r = -rMax; r <= rMax; r++) {
      if (predicate(q, r)) return { q, r };
    }
  }
  return null;
}

test("isRiverSource: only Mountains and Lake can originate a river; all other terrains never do", () => {
  for (let q = -20; q <= 20; q += 4) {
    for (let r = -20; r <= 20; r += 4) {
      const { terrain, elevation } = biomeAt("seed", q, r);
      if (terrain !== "Mountains" && terrain !== "Lake") {
        assert.equal(isRiverSource("seed", q, r, terrain, elevation), false);
      }
    }
  }
});

test("isRiverSource: a Lake can spontaneously originate a river — rare, not universal, not never", () => {
  let lakes = 0, origins = 0;
  for (let s = 0; s < 60; s++) {
    const seed = `lakeorigin-${s}`;
    for (let q = -20; q <= 20; q += 2) {
      for (let r = -20; r <= 20; r += 2) {
        const { terrain, elevation } = biomeAt(seed, q, r);
        if (terrain !== "Lake") continue;
        lakes++;
        if (isRiverSource(seed, q, r, terrain, elevation)) origins++;
      }
    }
  }
  assert.ok(lakes > 50, `expected a reasonable Lake sample, got ${lakes}`);
  assert.ok(origins > 0, "expected at least one spontaneous lake-origin across many seeds");
  assert.ok(origins < lakes * 0.5, "expected lake origins to be a small minority of lakes");
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

test("isRiverSource: a Mountains hex that is NOT a local peak never sources (needs to be the top)", () => {
  // A Mountains hex with a strictly-higher neighbour should never be a source,
  // regardless of the density roll — peak-detection gates it out first.
  const spot = findCoord("seed", (q, r) => {
    const { terrain, elevation } = biomeAt("seed", q, r);
    if (terrain !== "Mountains") return false;
    // has a higher neighbour (not a peak)
    const NEIGHBOR_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return NEIGHBOR_DIRS.some(([dq, dr]) => biomeAt("seed", q + dq, r + dr).elevation > elevation);
  }, { qMax: 40, rMax: 40 });
  assert.ok(spot, "expected a non-peak Mountains hex in range");
  const { terrain, elevation } = biomeAt("seed", spot.q, spot.r);
  assert.equal(isRiverSource("seed", spot.q, spot.r, terrain, elevation), false);
});
