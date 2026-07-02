// River sources (Phase 3R.5) — deciding which hexes ORIGINATE a river. The
// path each source takes to the sea is traced separately (js/gen/river-trace.js)
// and stored in world.rivers[]; this module answers only "does a river start
// here?", a pure per-hex function of (seed, q, r).
//
// History: rivers first shipped as a per-hex FLOW model — each hex picked its
// own downhill edge and the river grew forward one hex at a time, pooling into
// a Lake at the first local minimum. That model (downhillDirection, lake
// overflow, forward stitching, etc.) never got more than ~10-15% of rivers to
// reach the sea, because elevation and the continent/sea gate are independent
// noise fields (see the long rationale in river-trace.js). It was replaced by
// up-front tracing; all that survives here is source DETECTION, which the
// tracer consumes.

import { neighbors } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";
import { elevationAt } from "./biome.js";

// Density history: shipped at 0.06 ("rare and dramatic": ~1 source per
// 1200-2000 hexes) — real GM usage found that vanishingly rare. Bumped to
// 0.25, then to 0.35 (~11 sources per 2800-hex single fill), which lands near
// the requested ~8 rivers in realistic fragmented exploration where part of
// every river falls outside the explored area. Now that every source traces
// all the way to the sea (rather than dying at a nearby pond), each source is
// a full, long watercourse — 0.35 kept, since a source is now much more
// visually "worth it" and long rivers read as landmarks.
const RIVER_SOURCE_CHANCE = 0.35;

// A lake can also SPONTANEOUSLY originate a river (real-play request: "a lake
// can be an origin"). A spring-fed lake with no visible inflow still drains
// somewhere. Rolled per lake hex, so a multi-hex lake cluster's effective
// chance scales with its size. Rarer than a mountain source but no longer
// never-seen.
const LAKE_SOURCE_CHANCE = 0.08;

// A hex is a local elevation peak if none of its 6 neighbours are higher
// (full-detail elevation, matching classifyLand's own field, since peak
// detection is about "is this really the top of a Mountain," not flow).
function isLocalPeak(seed, q, r, elevationHere) {
  return neighbors(q, r).every((n) => elevationAt(seed, n.q, n.r) <= elevationHere);
}

/**
 * Whether (q, r) ORIGINATES a river: a local Mountains peak, or a Lake, that
 * passes its seeded density roll. Pure function of (seed, q, r, terrain,
 * elevation) — no history dependence. The tracer (js/gen/river-trace.js) then
 * routes the river from here to the sea.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {string} terrain already-classified terrain for this hex
 * @param {number} elevation this hex's own elevation (avoids resampling it)
 * @returns {boolean}
 */
export function isRiverSource(seed, q, r, terrain, elevation) {
  if (terrain === "Lake") return subRng(seed, "lake-source", q, r)() < LAKE_SOURCE_CHANCE;
  if (terrain !== "Mountains") return false;
  if (!isLocalPeak(seed, q, r, elevation)) return false;
  return subRng(seed, "river-source", q, r)() < RIVER_SOURCE_CHANCE;
}
