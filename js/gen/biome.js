// Terrain generation v2 — the elevation/moisture biome classifier (Phase 3R.3).
//
// Pure module: two independent noise fields (elevation, moisture) sampled per
// hex, combined via Whittaker-diagram-style threshold bins into one of the
// existing 7 terrains. Replaces the retired neighbour-affinity mechanism
// (js/gen/terrain-affinity.js, deleted) as the coherence mechanism — a hex's
// terrain is now a pure function of (seed, q, r), so it's order-independent
// by construction rather than depending on which neighbours already existed
// at generation time.
//
// Thresholds are PERCENTILE-calibrated against the actual output distribution
// of fbm2D (verified stable across a range of frequencies) — NOT naive splits
// of [0,1). FBM output clusters toward the middle of its range, so a naive
// linear threshold badly misjudges biome proportions (an early draft of this
// classifier, using [0,1)-linear thresholds, produced a single terrain
// covering ~65% of a test map). Water fresh/salt subtyping is 3R.4's job,
// built on top of the elevation this module produces.

import { fbm2D } from "../core/noise.js";

const NOISE_OPTS = { octaves: 3, frequency: 0.2, lacunarity: 2, persistence: 0.5 };

// Axial -> an approximately-isotropic Cartesian coordinate, reusing hexgeo's
// own pointy-top projection shape (see js/core/hexgeo.js axialToPixel) so
// noise patches read as round-ish regions rather than axial-sheared ones.
function axialToNoiseXY(q, r) {
  return { x: q + r / 2, y: r * (Math.sqrt(3) / 2) };
}

/**
 * Classify a terrain from elevation/moisture in [0,1)x[0,1) (Whittaker-style
 * threshold bins, percentile-calibrated — see module comment). Pure, no rng.
 * @param {number} elevation
 * @param {number} moisture
 * @returns {string} one of Forest/Plains/Hills/Mountains/Swamp/Desert/Water
 */
export function classifyBiome(elevation, moisture) {
  if (elevation >= 0.68) return "Mountains"; // top ~12%
  if (elevation >= 0.58) return "Hills"; // next ~21%
  if (elevation < 0.35) {
    // bottom ~15%: the water/wetland band, split by moisture (~median).
    return moisture >= 0.47 ? "Swamp" : "Water";
  }
  if (moisture < 0.35) return "Desert"; // driest slice of the mid band
  if (moisture >= 0.51) return "Forest"; // wettest half of what's left
  return "Plains";
}

/**
 * Sample elevation+moisture for a hex's axial coords and classify its biome.
 * A pure function of (seed, q, r) alone — order-independent by construction.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @returns {{ elevation: number, moisture: number, terrain: string }}
 */
export function biomeAt(seed, q, r) {
  const { x, y } = axialToNoiseXY(q, r);
  const elevation = fbm2D(seed, "elevation", x, y, NOISE_OPTS);
  const moisture = fbm2D(seed, "moisture", x, y, NOISE_OPTS);
  return { elevation, moisture, terrain: classifyBiome(elevation, moisture) };
}
