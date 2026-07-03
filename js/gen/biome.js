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
//
// Sea contagion (also 3R.4): a manually-placed (or procedurally-rolled) Sea
// hex should make NEARBY future generation more likely to continue the
// coastline, not sit inert next to whatever the continent field happens to
// say. This is a deliberate, narrowly-scoped exception to "pure function of
// position" — see rollSeaContagion below.

import { fbm2D, smoothstep } from "../core/noise.js";
import { axialDistance, axialKey, neighbors } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";

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
// near the origin so the spawn area is always land, without touching the
// field's behaviour further out.
//
// FALLOFF_RADIUS shrank 30 → 15 (real-play: "not enough rivers reach the
// sea"). The diagnosis: a Huge fill (radius 15) centred on the origin sat
// ENTIRELY inside the old 30-hex land bubble, so it contained ZERO Sea
// (measured 0/8 sample maps) — rivers literally couldn't reach a coast that
// wasn't generated. At falloff 15 the immediate start area (inner ~5 rings)
// stays reliably land (origin never Sea across 40 seeds; the r3 start disc is
// always fully land), but real coastline now appears within a starting Huge
// fill in ~55% of maps (avg ~180 Sea hexes vs ~0 before) — so rivers have a
// sea to flow to. LAND_BOOST unchanged (the spawn safety margin).
const LAND_BOOST = 0.7;
const FALLOFF_RADIUS = 15;
function originLandBias(q, r) {
  const t = Math.max(0, Math.min(1, 1 - axialDistance(0, 0, q, r) / FALLOFF_RADIUS));
  return LAND_BOOST * smoothstep(t);
}

// Sea contagion: placing (or generating) a Sea hex should make hexes
// generated NEAR it more likely to continue the coastline, decaying the
// further out you go, until land randomly breaks through as an island or
// continent. This is the one deliberate exception to "terrain is a pure
// function of (seed, q, r)" — it depends on generation history (which
// neighbours are already placed), by design, so manual/procedural Sea
// placements actually propagate rather than sitting inert next to whatever
// the continent field says. Chance compounds with more Sea neighbours
// (capped at 1), and always leaves an escape hatch — it's never certain, so
// a coastline eventually gives way to land if you keep going.
const SEA_CONTAGION_CHANCE = 0.75; // per already-placed Sea neighbour
function rollSeaContagion(seed, q, r, seaNeighborCount) {
  if (seaNeighborCount <= 0) return false;
  const chance = 1 - Math.pow(1 - SEA_CONTAGION_CHANCE, seaNeighborCount);
  return subRng(seed, "hex", q, r, "seaContagion")() < chance;
}

// Axial -> an approximately-isotropic Cartesian coordinate, reusing hexgeo's
// own pointy-top projection shape (see js/core/hexgeo.js axialToPixel) so
// noise patches read as round-ish regions rather than axial-sheared ones.
function axialToNoiseXY(q, r) {
  return { x: q + r / 2, y: r * (Math.sqrt(3) / 2) };
}

/**
 * Sample raw elevation at any coordinate — exported for js/gen/river.js,
 * which needs to peek at NEIGHBOURING hexes' elevation (placed or not; it's
 * a pure function of position, same as everywhere else in this module).
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {number} [octaves] override the default octave count — river.js
 *   uses a lower count for a smoothed "flow direction" signal, since the
 *   full-detail field has enough small texture to get flow stuck on noise.
 * @returns {number} in [0,1)
 */
export function elevationAt(seed, q, r, octaves = NOISE_OPTS.octaves) {
  const { x, y } = axialToNoiseXY(q, r);
  return fbm2D(seed, "elevation", x, y, { ...NOISE_OPTS, octaves });
}

/**
 * Sample raw moisture at any coordinate — exported for js/gen/river.js's
 * swamp/wetland attraction (a river's flow direction is biased toward
 * wetter neighbours, not just the steepest drop), same rationale as
 * elevationAt: needs to peek at neighbouring hexes regardless of whether
 * they're placed yet.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {number} in [0,1)
 */
export function moistureAt(seed, q, r) {
  const { x, y } = axialToNoiseXY(q, r);
  return fbm2D(seed, "moisture", x, y, NOISE_OPTS);
}

/**
 * Sample the raw continent gate field at any coordinate (before the origin
 * land-bias / threshold are applied) — exported for js/gen/river.js, which
 * biases flow direction toward decreasing continent (i.e. toward the coast):
 * continent is a much coarser field than elevation, so it doesn't meaningfully
 * affect any single step's choice, but consistently nudges a long path's
 * overall drift toward the sea over many hexes.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {number} in [0,1), pre-bias/pre-threshold
 */
export function continentAt(seed, q, r) {
  const { x, y } = axialToNoiseXY(q, r);
  return fbm2D(seed, "continent", x, y, CONTINENT_OPTS);
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
 * its biome. Pure function of (seed, q, r) alone WHEN seaNeighborCount is 0
 * (the default) — order-independent by construction, same as 3R.3/3R.4. A
 * non-zero seaNeighborCount deliberately breaks that purity (see module
 * comment on sea contagion): it lets already-placed Sea neighbours "grow"
 * the coastline into newly-generated hexes nearby.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @param {number} [seaNeighborCount] how many of this hex's already-placed
 *   neighbours are Sea (0-6); 0 = today's pure position-based behaviour.
 * @returns {{ elevation: number, moisture: number, continent: number|null, terrain: string }}
 */
// Coastal-lake "bay" rule (3R.5 follow-up, real-play bug): the low-elevation
// Lake band has no relationship to the continent gate, so a hex could barely
// clear the ocean threshold yet classify Lake — producing lone "lake" tiles
// marooned in open ocean, and fresh lakes sitting directly on the coastline.
// A margin-based fix (reclassify near-threshold Lakes as Sea) was prototyped
// and REJECTED: it just moves the coastline inland one band — the lakes
// immediately behind the new boundary become the new adjacent ones (verified:
// adjacency count was unchanged across every margin tried). The working fix
// treats a connected cluster of would-be-Lake hexes as ONE body of water: if
// the cluster touches raw ocean anywhere, it's a bay/inlet — salt water, the
// WHOLE cluster is Sea. Still a pure function of position (a bounded
// flood-fill over pure per-hex classifications, no early exit, so every
// member of a cluster computes the identical answer regardless of generation
// order — verified: zero cluster-mate disagreements across sampled maps).
// A cluster bigger than the cap stays Lake for everyone (a genuinely huge
// inland lake; the cap only bounds cost — natural clusters average 6-9 hexes).
const LAKE_REGION_CAP = 48;

// Position-pure terrain before the contagion/bay adjustments — the base
// classification the bay fill runs over.
function rawTerrainAt(seed, q, r) {
  const continent = continentAt(seed, q, r) + originLandBias(q, r);
  if (continent < OCEAN_THRESHOLD) return "Sea";
  return classifyLand(elevationAt(seed, q, r), moistureAt(seed, q, r));
}

/**
 * Whether the ocean gate classifies (q, r) as open Sea — the coarse
 * continent field (plus the origin land-bias) below OCEAN_THRESHOLD. This is
 * the position-pure sea test (the same gate biomeAt/rawTerrainAt use, before
 * sea-contagion or the bay rule), exported for js/gen/river-trace.js so a
 * traced river targets exactly the coastline the map will actually render.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {boolean}
 */
export function isOceanAt(seed, q, r) {
  return continentAt(seed, q, r) + originLandBias(q, r) < OCEAN_THRESHOLD;
}

/**
 * Whether (q, r) is any body of WATER — Sea (the ocean gate) OR a fresh Lake
 * (the low-elevation/low-moisture band). Pure and computable at any coordinate
 * (placed or not), exported for js/gen/river-trace.js so a river terminates at
 * the first water it touches instead of routing THROUGH a lake/bay and on to
 * the raw ocean gate. Note it doesn't run the bay flood-fill or sea contagion
 * (both history/cluster dependent) — but a bay-flipped hex is classifyLand-Lake
 * anyway, so it still reads as water here; only the exact Sea-vs-Lake label
 * would differ, which doesn't matter for "stop at water".
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {boolean}
 */
export function isWaterAt(seed, q, r) {
  if (isOceanAt(seed, q, r)) return true;
  return classifyLand(elevationAt(seed, q, r), moistureAt(seed, q, r)) === "Lake";
}

function lakeRegionTouchesSea(seed, q, r) {
  const seen = new Set([axialKey(q, r)]);
  const queue = [{ q, r }];
  let touchesSea = false;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r);
      if (seen.has(nk)) continue;
      const t = rawTerrainAt(seed, n.q, n.r);
      if (t === "Sea") { touchesSea = true; continue; }
      if (t !== "Lake") continue;
      seen.add(nk);
      if (seen.size > LAKE_REGION_CAP) return false; // huge inland lake — stays Lake
      queue.push(n);
    }
  }
  return touchesSea;
}

export function biomeAt(seed, q, r, seaNeighborCount = 0) {
  // Always sampled, even for Sea hexes — mirrors elevation/moisture's own
  // "always compute regardless of what it's used for" precedent, so the
  // field stays available uniformly (e.g. a manually-placed Sea hex still
  // carries real local elevation/moisture for later sub-phases).
  const elevation = elevationAt(seed, q, r);
  const moisture = moistureAt(seed, q, r);
  if (rollSeaContagion(seed, q, r, seaNeighborCount)) {
    return { elevation, moisture, continent: null, terrain: "Sea" };
  }
  const continent = continentAt(seed, q, r) + originLandBias(q, r);
  let terrain = continent < OCEAN_THRESHOLD ? "Sea" : classifyLand(elevation, moisture);
  if (terrain === "Lake" && lakeRegionTouchesSea(seed, q, r)) terrain = "Sea";
  return { elevation, moisture, continent, terrain };
}
