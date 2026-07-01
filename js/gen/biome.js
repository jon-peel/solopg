// Terrain generation v2 — the elevation/moisture/basin biome classifier
// (Phase 3R.3 + 3R.4).
//
// Pure module: independent noise fields sampled per hex, combined via
// Whittaker-diagram-style threshold bins into one of the 8 terrains. Replaces
// the retired neighbour-affinity mechanism (js/gen/terrain-affinity.js,
// deleted) as the coherence mechanism — a hex's terrain is a pure function of
// (seed, q, r), so it's order-independent by construction rather than
// depending on which neighbours already existed at generation time.
//
// Elevation/moisture thresholds are PERCENTILE-calibrated against the actual
// output distribution of fbm2D (verified stable across a range of
// frequencies) — NOT naive splits of [0,1). FBM output clusters toward the
// middle of its range, so a naive linear threshold badly misjudges biome
// proportions (an early draft of this classifier, using [0,1)-linear
// thresholds, produced a single terrain covering ~65% of a test map).
//
// Water (3R.4) splits into Lake (fresh) vs Sea (salt) via a THIRD, much
// coarser noise field, `basin` — not flood-fill. Flood-fill (the technique
// every real-world reference generator uses — see the 3R.2 research) assumes
// a fixed, bounded, one-shot-generated map; this world is infinite and grows
// incrementally, so there's no "map edge" to flood-fill from, and a bounded
// fill over just the currently-placed hexes would be unstable (a hex could
// flip from Lake to Sea later as more area is generated around it, breaking
// the order-independence 3R.3 established). `basin` sidesteps this entirely:
// it's a pure function of position just like elevation/moisture, just sampled
// at a much lower frequency so it varies over tens of hexes instead of ~5 —
// large contiguous low-basin regions read as Sea, small pockets elsewhere
// read as Lake, with no connectivity search needed.

import { fbm2D } from "../core/noise.js";

const NOISE_OPTS = { octaves: 3, frequency: 0.2, lacunarity: 2, persistence: 0.5 };
const BASIN_OPTS = { octaves: 2, frequency: 0.05, lacunarity: 2, persistence: 0.5 };
const BASIN_THRESHOLD = 0.5; // even split; retune via test/stats-harness.js if needed

// Axial -> an approximately-isotropic Cartesian coordinate, reusing hexgeo's
// own pointy-top projection shape (see js/core/hexgeo.js axialToPixel) so
// noise patches read as round-ish regions rather than axial-sheared ones.
function axialToNoiseXY(q, r) {
  return { x: q + r / 2, y: r * (Math.sqrt(3) / 2) };
}

/**
 * Classify a terrain from elevation/moisture/basin (Whittaker-style threshold
 * bins, percentile-calibrated — see module comment). Pure, no rng.
 * @param {number} elevation in [0,1)
 * @param {number} moisture in [0,1)
 * @param {number} basin in [0,1) — only consulted in the low-elevation band
 * @returns {string} one of Forest/Plains/Hills/Mountains/Swamp/Desert/Lake/Sea
 */
export function classifyBiome(elevation, moisture, basin) {
  if (elevation >= 0.68) return "Mountains"; // top ~12%
  if (elevation >= 0.58) return "Hills"; // next ~21%
  if (elevation < 0.35) {
    // bottom ~15%: the water/wetland band, split by moisture (~median);
    // within the water side, basin splits Sea (large coastal/oceanic
    // regions) from Lake (smaller inland pockets).
    if (moisture >= 0.47) return "Swamp";
    return basin < BASIN_THRESHOLD ? "Sea" : "Lake";
  }
  if (moisture < 0.35) return "Desert"; // driest slice of the mid band
  if (moisture >= 0.51) return "Forest"; // wettest half of what's left
  return "Plains";
}

/**
 * Sample elevation+moisture+basin for a hex's axial coords and classify its
 * biome. A pure function of (seed, q, r) alone — order-independent by
 * construction.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @returns {{ elevation: number, moisture: number, basin: number, terrain: string }}
 */
export function biomeAt(seed, q, r) {
  const { x, y } = axialToNoiseXY(q, r);
  const elevation = fbm2D(seed, "elevation", x, y, NOISE_OPTS);
  const moisture = fbm2D(seed, "moisture", x, y, NOISE_OPTS);
  // Always sampled, even for non-water hexes — mirrors elevation/moisture's
  // own "always compute regardless of what it's used for" precedent, so the
  // field stays available uniformly for later sub-phases (e.g. a coastal-
  // region signal for settlement boosts or road routing).
  const basin = fbm2D(seed, "basin", x, y, BASIN_OPTS);
  return { elevation, moisture, basin, terrain: classifyBiome(elevation, moisture, basin) };
}
