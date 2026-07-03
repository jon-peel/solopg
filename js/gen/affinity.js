// Terrain generation v3 — neighbour-affinity dice roll (no elevation).
//
// Replaces the elevation/moisture/continent noise classifier (3R.3/3R.4,
// js/gen/biome.js, deleted). The world is a hex ORACLE: every un-revealed hex
// is a superposition of possible terrains, and it only collapses to a concrete
// terrain when the GM reveals it — a weighted dice roll biased by its
// already-revealed neighbours. This deliberately gives up strict
// (seed, q, r) determinism (a hex's terrain now depends on which neighbours
// were revealed first) — an intentional design choice: it makes the generator
// match the oracle metaphor and lets rivers/features shape terrain later.
//
// The weight model is ADDITIVE with a decaying spawn term:
//   weight[T] = SPAWN[T] * spawnScale(n)  +  sum over revealed neighbours N of AFFINITY[N][T]
//   spawnScale(n) = 1 / (1 + DECAY * n)          (n = revealed-neighbour count)
// clamped at >= 0, then a seeded weighted pick.
//
//  - SPAWN seeds a fresh cluster from nothing; it DECAYS as a hex gains
//    revealed neighbours, so terrains seed at the exploration frontier but
//    CONFORM once surrounded (this is what keeps regions clean, not speckly).
//    Proportions track SPAWN, roughly independent of the affinity strengths.
//  - AFFINITY[N][T] is additive, so K neighbours of the same kind stack to
//    K x the bonus. SELF-affinity (diagonal) is cranked hard so the majority
//    neighbour wins decisively — big cohesive regions. Cross terms encode the
//    gradients (mountains want hills beside them, hills want forest/plains,
//    desert shuns forest, etc). A large negative (e.g. Sea<->Lake) is a soft
//    forbid after the >=0 clamp: a Lake never forms touching Sea and vice
//    versa (no lakes in the ocean; a coastal lake would be a lagoon, disallowed
//    for now). All the numbers were tuned against real generated output —
//    proportions, lone-hex rate (~3-4%), cluster sizes, and these rules — in
//    the scratchpad before landing here.
//
// Sea vs Lake needs no continent gate anymore: Sea has strong self-affinity so
// it forms big bodies/coastlines; Lake has weaker self-affinity so it stays
// small and inland. Both are just terrains the roll produces.

import { NEIGHBOR_DIRS } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";

export const TERRAINS = ["Sea", "Lake", "Swamp", "Plains", "Forest", "Hills", "Mountains", "Desert"];

// Water terrains — a river ends when it meets one (used by later river work).
export const WATER_TERRAINS = new Set(["Sea", "Lake"]);

// Base propensity to seed a fresh cluster (before neighbour affinity). Sets the
// rough proportion of each terrain. Sea generous (big oceans), Lake/Swamp rare.
const SPAWN = { Sea: 2, Lake: 0.5, Swamp: 0.6, Plains: 4, Forest: 3.2, Hills: 1.6, Mountains: 1.6, Desert: 1 };

// How fast the spawn term decays with revealed-neighbour count. Higher = harder
// conformity in the interior (less speckle) but weaker frontier seeding.
const DECAY = 0.9;

// AFFINITY[neighbourTerrain][candidateTerrain] — additive. Diagonal (self) is
// cranked ~2.5x a natural level for clean regions; a -999 is a hard forbid.
const AFFINITY = {
  Sea:       { Sea: 35, Swamp: 1, Plains: -1, Forest: -1.5, Hills: -2, Mountains: -3, Desert: -1.5, Lake: -999 },
  Lake:      { Lake: 18, Swamp: 1.4, Plains: 0.5, Forest: 0.5, Sea: -999 },
  Swamp:     { Swamp: 13, Lake: 1.2, Plains: 1, Forest: 1, Sea: 1, Desert: -2, Mountains: -2 },
  Plains:    { Plains: 20, Forest: 2.5, Hills: 2, Desert: 1, Swamp: 0.5, Mountains: -3, Lake: 0.3 },
  Forest:    { Forest: 20, Plains: 2.5, Hills: 2, Swamp: 1, Lake: 0.5, Mountains: 0.5, Desert: -5 },
  Hills:     { Hills: 13, Mountains: 3, Forest: 2.2, Plains: 2.2, Desert: 0.6 },
  Mountains: { Mountains: 25, Hills: 7, Forest: 1.2, Desert: 2, Plains: -4, Swamp: -3, Lake: -1, Sea: -3 },
  Desert:    { Desert: 20, Plains: 1.5, Mountains: 1, Hills: 0.6, Forest: -5, Swamp: -2, Sea: -1.5 },
};

/**
 * Collapse the hex at (q, r) to a terrain: a seeded weighted roll biased by the
 * terrains of its already-revealed neighbours (see the module comment). The
 * fixed world origin (0, 0), revealed with no neighbours, always spawns on land
 * so a new world's GM never starts in open ocean.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @param {string[]} neighborTerrains terrains of this hex's already-placed
 *   neighbours (any order); empty for a hex revealed with none.
 * @returns {string} one of TERRAINS
 */
export function terrainAt(seed, q, r, neighborTerrains = []) {
  if (q === 0 && r === 0 && neighborTerrains.length === 0) return "Plains";
  const spawnScale = 1 / (1 + DECAY * neighborTerrains.length);
  const weights = [];
  let total = 0;
  for (const t of TERRAINS) {
    let w = SPAWN[t] * spawnScale;
    for (const n of neighborTerrains) {
      const a = AFFINITY[n];
      if (a && a[t] !== undefined) w += a[t];
    }
    if (w < 0) w = 0;
    weights.push(w);
    total += w;
  }
  if (total <= 0) return "Plains";
  let roll = subRng(seed, "terrain", q, r)() * total;
  for (let i = 0; i < TERRAINS.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return TERRAINS[i];
  }
  return TERRAINS[TERRAINS.length - 1]; // floating-point fallback
}

/**
 * Convenience for callers holding a "get terrain at neighbour" lookup: collect
 * the terrains of (q, r)'s already-placed neighbours in NEIGHBOR_DIRS order.
 * @param {number} q
 * @param {number} r
 * @param {(nq:number, nr:number) => string|undefined} terrainOfPlaced returns a
 *   placed neighbour's terrain, or undefined if that neighbour isn't placed.
 * @returns {string[]}
 */
export function neighborTerrainsOf(q, r, terrainOfPlaced) {
  const out = [];
  for (const [dq, dr] of NEIGHBOR_DIRS) {
    const t = terrainOfPlaced(q + dq, r + dr);
    if (t) out.push(t);
  }
  return out;
}
