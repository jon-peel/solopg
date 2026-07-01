// River tracing (Phase 3R.5) — steepest-descent paths from mountain peaks to
// a Lake/Sea sink.
//
// Every previous 3R.3/3R.4 mechanism classifies a hex from (seed, q, r) alone
// (elevation/moisture/continent), plus one narrow exception (sea contagion,
// js/gen/biome.js) that reads already-placed neighbours. Rivers can't be pure
// per-hex the same way elevation is — a river is a PATH spanning dozens of
// hexes from a distant mountain source to a distant sink, and the world is
// infinite/incremental (no fixed map to flood-fill or pre-trace, same
// constraint 3R.4 hit for coastlines).
//
// The first design measured a fully analytical per-hex query (scan every
// candidate source within a search radius, trace each one from scratch, see
// if it passes through the queried hex) at ~28ms/hex — a 1951-hex "Generate
// Area" fill would take close to a minute. Not viable for interactive use.
//
// Fix: reuse the SEA CONTAGION pattern instead of brute-force analytical
// tracing. A hex only needs to know two cheap things, both O(1)/O(6):
//   1. Is this hex itself a river source? (local peak + a seeded chance roll)
//   2. Do any of its already-placed neighbours have a river edge pointing
//      INTO this hex? (checked by the caller — see js/ui/app.js
//      incomingRiverEdges — mirroring seaNeighborCount exactly)
// Given those, this hex decides its own outgoing edge (or terminates/floods
// a Lake) by sampling downhill direction locally. The river then "grows"
// forward as hexes are generated, one hex at a time, the same way a Sea
// coastline grows via rollSeaContagion — NOT recomputed from a stored path.
//
// This is a SECOND deliberate exception to position-purity (rivers depend on
// which upstream neighbour was already placed, and in what state), but for a
// different reason than sea contagion: not responsiveness to a manual
// placement, but raw performance of an otherwise-correct analytical model.

import { neighbors, NEIGHBOR_DIRS } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";
import { elevationAt } from "./biome.js";

// Tuned for "rare and dramatic" (explicit design call — see the 3R.5 plan):
// verified in the scratchpad that with Mountains ~12% of hexes and local
// peaks a further ~1-1.5% of ALL hexes, this chance yields roughly one river
// source per 1200-2000 hexes generated — a notable landmark, not routine
// terrain.
const RIVER_SOURCE_CHANCE = 0.06;

// Flow-direction uses FEWER octaves than terrain classification's elevation
// (NOISE_OPTS.octaves = 3) — a smoothed field so steepest-descent tracks the
// real landform slope instead of getting stuck in fine-grained noise texture
// that has no bearing on which way water would actually run.
const FLOW_OCTAVES = 1;

// A hex is a local elevation peak if none of its 6 neighbours are higher
// (using full-detail elevation, matching classifyLand's own field, since
// peak-detection is about "is this really the top of a Mountain," not flow).
function isLocalPeak(seed, q, r, elevationHere) {
  return neighbors(q, r).every((n) => elevationAt(seed, n.q, n.r) <= elevationHere);
}

/**
 * Whether (q, r) is a river source: a local Mountains peak that passes a
 * seeded density-chance roll. Pure function of (seed, q, r, terrain,
 * elevation) — no history dependence.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {string} terrain already-classified terrain for this hex
 * @param {number} elevation this hex's own elevation (avoids resampling it)
 * @returns {boolean}
 */
export function isRiverSource(seed, q, r, terrain, elevation) {
  if (terrain !== "Mountains") return false;
  if (!isLocalPeak(seed, q, r, elevation)) return false;
  return subRng(seed, "river-source", q, r)() < RIVER_SOURCE_CHANCE;
}

/**
 * The NEIGHBOR_DIRS index this hex's water would flow out toward — the
 * neighbour with the lowest smoothed elevation, provided it's actually lower
 * than here (never uphill). Pure function of (seed, q, r).
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {number} a NEIGHBOR_DIRS index, or -1 if every neighbour is >= here
 *   (a landlocked depression — the caller floods it into a Lake instead).
 */
export function downhillDirection(seed, q, r) {
  const here = elevationAt(seed, q, r, FLOW_OCTAVES);
  let bestDir = -1;
  let bestElev = here;
  NEIGHBOR_DIRS.forEach(([dq, dr], i) => {
    const e = elevationAt(seed, q + dq, r + dr, FLOW_OCTAVES);
    if (e < bestElev) {
      bestElev = e;
      bestDir = i;
    }
  });
  return bestDir;
}

/**
 * Decide this hex's river state, given which of its sides already carry an
 * incoming edge from an already-placed upstream neighbour (see
 * js/ui/app.js's incomingRiverEdges, which mirrors seaNeighborCount).
 *
 * A hex with incoming edges keeps them and, if it's dry land, adds one
 * outgoing edge toward the lowest neighbour (steepest descent — never
 * uphill). A dry hex with no incoming edges may still originate a NEW river
 * if it qualifies as a source (isRiverSource). Reaching Lake/Sea, or a
 * hex with no incoming edges that isn't a source, simply terminates/does
 * nothing. A depression (no incoming, IS carrying a river, but every
 * neighbour is uphill) reports forceLake so the caller overrides this hex's
 * terrain to Lake — the river's new sink (no carving logic in v1).
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {string} terrain this hex's already-classified terrain
 * @param {number} elevation this hex's own elevation
 * @param {number[]} incomingDirs NEIGHBOR_DIRS indices with an edge INTO this hex
 * @returns {{ riverEdges: number[], forceLake: boolean }}
 */
export function riverStateAt(seed, q, r, terrain, elevation, incomingDirs) {
  const hasIncoming = incomingDirs.length > 0;
  const isSource = !hasIncoming && isRiverSource(seed, q, r, terrain, elevation);
  if (!hasIncoming && !isSource) return { riverEdges: [], forceLake: false };

  const edges = [...incomingDirs];
  if (terrain === "Sea" || terrain === "Lake") return { riverEdges: edges, forceLake: false };

  const outDir = downhillDirection(seed, q, r);
  if (outDir === -1) return { riverEdges: edges, forceLake: true };
  edges.push(outDir);
  return { riverEdges: edges, forceLake: false };
}
