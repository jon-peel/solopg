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
import { elevationAt, moistureAt, continentAt } from "./biome.js";

// Tuned for "rare and dramatic" (explicit design call — see the 3R.5 plan).
// First shipped at 0.06 (roughly one source per 1200-2000 hexes), but real
// GM usage (~50 "Generate Area" clicks, ~1350 unique hexes) turned up only 1
// small river — confirmed via a scratchpad simulation of many scattered
// area-fills (matching how a GM actually explores, not one single big fill)
// that 0.06 averages under 1 river per similarly-sized map. Bumped to 0.25
// (~4x): the same simulation shows ~3-4 rivers per map of that size, still
// clearly a landmark rather than routine terrain (most Mountains hexes still
// have none), just no longer vanishingly rare.
const RIVER_SOURCE_CHANCE = 0.25;

// Flow-direction uses FEWER octaves than terrain classification's elevation
// (NOISE_OPTS.octaves = 3) — a smoothed field so steepest-descent tracks the
// real landform slope instead of getting stuck in fine-grained noise texture
// that has no bearing on which way water would actually run.
const FLOW_OCTAVES = 1;

// Flow direction v2 (3R.5 follow-up, on request — "longer, windier, real
// transportation routes"). The original design always picked the single
// steepest downhill neighbour — deterministic, but that made every river a
// short, direct line: verified via scratchpad tracing that real paths ran
// only 5-12 hexes before hitting a Lake/depression, with no meander and no
// pull toward nearby wetlands or the coast.
//
// v2 scores every valid downhill candidate (still strictly lower elevation —
// "never uphill" is unconditional, unchanged) on three factors, then makes a
// SEEDED WEIGHTED-RANDOM pick among them (still a pure, deterministic
// function of (seed, q, r) — same subRng-derived draw every time):
//   1. Elevation drop (the original signal) — bigger drop, more likely.
//   2. Moisture attraction (SWAMP_ATTRACTION) — a neighbour with more
//      moisture pulls the choice toward it, an approximation of "wetlands
//      downstream draw the river toward them." Moisture is a smooth,
//      spatially-correlated field (unlike raw per-hex noise), so a cheap
//      "prefer the wetter of my 6 neighbours" rule, applied every step,
//      compounds into a genuine multi-hex drift toward a wetland cluster —
//      no expensive wide-radius lookahead needed.
//   3. Coastward pull (COAST_PULL) — a neighbour with LOWER `continent`
//      (closer to the ocean gate) pulls the choice toward it. `continent` is
//      a much coarser field than elevation (~13x smaller step-to-step
//      difference, measured in the scratchpad), so on its own it's far too
//      faint to matter for any single hex's choice — but a small, CONSISTENT
//      per-step bias compounds over a long path into real large-scale drift
//      toward the sea, which raw elevation alone has no reason to produce
//      (elevation and continent are independent noise fields).
//
// A "prefer neighbours that aren't placed yet" bias was also prototyped (to
// dodge the incremental-generation dead-end case — see the stitching
// comment on riverStateAt below) but measured WORSE on every metric in both
// a single-big-fill and a many-scattered-clicks scratchpad simulation: it
// pushes rivers to rush toward the edge of whatever's been generated so far,
// cutting the VISIBLE portion of the river short. Stitching alone (already
// narrowly scoped, see js/ui/app.js) turned out to fully resolve the
// "points at an already-placed dry neighbour" case without needing the flow
// direction itself to know about world state at all — so this stays a pure
// function of (seed, q, r), same as before.
const SWAMP_ATTRACTION = 0.8;
const COAST_PULL = 150; // large multiplier -- continent's own gradient is tiny by design (coarse field)

function scoreCandidates(seed, q, r) {
  const here = elevationAt(seed, q, r, FLOW_OCTAVES);
  const hereContinent = continentAt(seed, q, r);
  const candidates = [];
  NEIGHBOR_DIRS.forEach(([dq, dr], i) => {
    const nq = q + dq, nr = r + dr;
    const there = elevationAt(seed, nq, nr, FLOW_OCTAVES);
    if (there >= here) return; // never uphill -- unconditional
    const drop = here - there;
    const swampPull = SWAMP_ATTRACTION * moistureAt(seed, nq, nr);
    const coastPull = COAST_PULL * (hereContinent - continentAt(seed, nq, nr));
    candidates.push({ i, weight: Math.max(0.0001, drop + swampPull + coastPull) });
  });
  return candidates;
}

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
 * The NEIGHBOR_DIRS index this hex's water flows out toward — a seeded
 * weighted-random pick among every strictly-downhill neighbour (never
 * uphill), weighted by elevation drop plus a swamp/wetland attraction and a
 * coastward pull (see the module comment above for the full rationale).
 * Still a pure, deterministic function of (seed, q, r) — the "randomness" is
 * a seeded draw that always resolves the same way for the same inputs.
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @returns {number} a NEIGHBOR_DIRS index, or -1 if every neighbour is >= here
 *   (a landlocked depression — the caller floods it into a Lake instead).
 */
export function downhillDirection(seed, q, r) {
  const candidates = scoreCandidates(seed, q, r);
  if (!candidates.length) return -1;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = subRng(seed, "river-flow", q, r)() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c.i;
  }
  return candidates[candidates.length - 1].i; // floating-point fallback
}

// Lake outflow (3R.5 follow-up, on request — real lakes commonly have both
// an inflow and an outflow). Reuses sea contagion's exact compounding shape
// (js/gen/biome.js SEA_CONTAGION_CHANCE): chance rises with more inflows,
// capped at 1, never certain. A Sea never gets an outflow roll — it's the
// world's actual ocean, the end of the line; only Lake (a landlocked body)
// can pass a river onward toward the next lake or the sea.
const LAKE_OUTFLOW_CHANCE = 0.5; // per inflow, compounding
function rollLakeOutflow(seed, q, r, inflowCount) {
  const chance = 1 - Math.pow(1 - LAKE_OUTFLOW_CHANCE, inflowCount);
  return subRng(seed, "lake-outflow", q, r)() < chance;
}

/**
 * Decide this hex's river state, given which of its sides already carry an
 * incoming edge from an already-placed upstream neighbour (see
 * js/ui/app.js's incomingRiverEdges, which mirrors seaNeighborCount).
 *
 * A hex with incoming edges keeps them and, if it's dry land, adds one
 * outgoing edge toward the lowest neighbour (steepest descent — never
 * uphill; Swamp counts as dry land here, the river passes through a wetland
 * rather than stopping at it). A dry hex with no incoming edges may still
 * originate a NEW river if it qualifies as a source (isRiverSource). A Lake
 * with incoming edges rolls a chance (rollLakeOutflow, compounding with more
 * inflows) to ALSO add an outgoing edge, letting the river continue past it
 * rather than always terminating there. Sea, or a hex with no incoming edges
 * that isn't a source, simply terminates/does nothing. A depression (no
 * incoming, IS carrying a river, but every neighbour is uphill) reports
 * forceLake so the caller overrides this hex's terrain to Lake — the river's
 * new sink (no carving logic in v1).
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
  if (terrain === "Sea") return { riverEdges: edges, forceLake: false };
  if (terrain === "Lake") {
    if (hasIncoming && rollLakeOutflow(seed, q, r, incomingDirs.length)) {
      const outDir = downhillDirection(seed, q, r);
      if (outDir !== -1) edges.push(outDir);
    }
    return { riverEdges: edges, forceLake: false };
  }

  const outDir = downhillDirection(seed, q, r);
  if (outDir === -1) return { riverEdges: edges, forceLake: true };
  edges.push(outDir);
  return { riverEdges: edges, forceLake: false };
}
