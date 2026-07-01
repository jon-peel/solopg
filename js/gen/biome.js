// Terrain generation v2 — the elevation/moisture/continent biome classifier
// (Phase 3R.3 + 3R.4).
//
// Pure module: independent noise fields sampled per hex, combined into one of
// the 8 terrains. Replaces the retired neighbour-affinity mechanism
// (js/gen/terrain-affinity.js, deleted) as the coherence mechanism — a hex's
// terrain is a pure function of (seed, q, r), so it's order-independent by
// construction rather than depending on which neighbours already existed at
// generation time.
//
// Elevation/moisture thresholds are PERCENTILE-calibrated against the actual
// output distribution of fbm2D (verified stable across a range of
// frequencies) — NOT naive splits of [0,1). FBM output clusters toward the
// middle of its range, so a naive linear threshold badly misjudges biome
// proportions (an early draft of this classifier, using [0,1)-linear
// thresholds, produced a single terrain covering ~65% of a test map).
//
// Water (3R.4) splits into Lake (fresh) vs Sea (salt) via a coarse `continent`
// field used as a land/ocean GATE — not flood-fill. Flood-fill (the technique
// every real-world reference generator uses — see the 3R.2 research) assumes
// a fixed, bounded, one-shot-generated map; this world is infinite and grows
// incrementally, so there's no "map edge" to flood-fill from, and a bounded
// fill over just the currently-placed hexes would be unstable (a hex could
// flip from Lake to Sea later as more area is generated around it, breaking
// the order-independence 3R.3 established).
//
// IMPORTANT: `continent` is a GATE, never blended into `elevation`. An
// earlier draft tried mixing a coarse continent-scale signal into elevation
// itself (either by widening elevation's own FBM to include very-low-
// frequency octaves, or by weighted-blending a separate coarse field in) —
// both broke Mountains almost entirely (some samples had none) and produced
// zero Lakes, because the coarse signal ended up dominating ordinary land
// elevation everywhere, leaving no room for local terrain variety or isolated
// inland lakes. Keeping `continent` as a pure yes/no gate — Sea below the
// threshold, otherwise run the ORIGINAL unchanged land classifier — decouples
// "is this the ocean" (large-scale) from "what's the local terrain"
// (existing, already-tuned logic), which is what actually produces real
// coastlines: huge contiguous Sea bodies at the gate boundary, with Mountains/
// Hills/Forest/Plains/Desert/Swamp proportions on the land side unaffected.

import { fbm2D, smoothstep } from "../core/noise.js";
import { axialDistance } from "../core/hexgeo.js";

// Land classification — UNCHANGED from 3R.3.
const NOISE_OPTS = { octaves: 3, frequency: 0.2, lacunarity: 2, persistence: 0.5 };

// Continent-scale land/ocean gate (~65-hex features — far coarser than
// elevation's ~5-hex texture) and the threshold below which a hex is Sea.
const CONTINENT_OPTS = { octaves: 2, frequency: 0.015, lacunarity: 2, persistence: 0.5 };
const OCEAN_THRESHOLD = 0.45;

// The world's spawn point is always the fixed origin (0,0) (app.js
// onNewWorld). Without this bias, some seeds place the origin deep in an
// ocean basin — verified: one seed gave 100% Sea AT the origin, another gave
// 95%+ Sea within the normal starting exploration radius, stranding a new
// world's GM in open ocean from the start. This smoothly boosts `continent`
// near the origin (falloff to zero by ~30 hexes out) so the spawn area is
// always land, without touching the field's behaviour anywhere else.
const LAND_BOOST = 0.7;
const FALLOFF_RADIUS = 30;
function originLandBias(q, r) {
  const t = Math.max(0, Math.min(1, 1 - axialDistance(0, 0, q, r) / FALLOFF_RADIUS));
  return LAND_BOOST * smoothstep(t);
}

// Axial -> an approximately-isotropic Cartesian coordinate, reusing hexgeo's
// own pointy-top projection shape (see js/core/hexgeo.js axialToPixel) so
// noise patches read as round-ish regions rather than axial-sheared ones.
function axialToNoiseXY(q, r) {
  return { x: q + r / 2, y: r * (Math.sqrt(3) / 2) };
}

/**
 * Classify LAND terrain from elevation/moisture (Whittaker-style threshold
 * bins, percentile-calibrated — see module comment). Pure, no rng. Never
 * returns Sea — the low-elevation band is always Lake here; Sea is decided
 * upstream by the continent gate in biomeAt, before this is even called.
 * @param {number} elevation in [0,1)
 * @param {number} moisture in [0,1)
 * @returns {string} one of Forest/Plains/Hills/Mountains/Swamp/Desert/Lake
 */
export function classifyLand(elevation, moisture) {
  if (elevation >= 0.68) return "Mountains"; // top ~12%
  if (elevation >= 0.58) return "Hills"; // next ~21%
  if (elevation < 0.35) {
    // bottom ~15%: the water/wetland band, split by moisture (~median).
    return moisture >= 0.47 ? "Swamp" : "Lake";
  }
  if (moisture < 0.35) return "Desert"; // driest slice of the mid band
  if (moisture >= 0.51) return "Forest"; // wettest half of what's left
  return "Plains";
}

/**
 * Sample elevation+moisture+continent for a hex's axial coords and classify
 * its biome. A pure function of (seed, q, r) alone — order-independent by
 * construction.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @returns {{ elevation: number, moisture: number, continent: number, terrain: string }}
 */
export function biomeAt(seed, q, r) {
  const { x, y } = axialToNoiseXY(q, r);
  const continent = fbm2D(seed, "continent", x, y, CONTINENT_OPTS) + originLandBias(q, r);
  // Always sampled, even for Sea hexes — mirrors elevation/moisture's own
  // "always compute regardless of what it's used for" precedent, so the
  // field stays available uniformly (e.g. a manually-placed Sea hex still
  // carries real local elevation/moisture for later sub-phases).
  const elevation = fbm2D(seed, "elevation", x, y, NOISE_OPTS);
  const moisture = fbm2D(seed, "moisture", x, y, NOISE_OPTS);
  const terrain = continent < OCEAN_THRESHOLD ? "Sea" : classifyLand(elevation, moisture);
  return { elevation, moisture, continent, terrain };
}
