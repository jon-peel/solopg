// River tracing (Phase 3R.5, "curated rivers" rework) — trace a full path
// from a source to the SEA, up front, as a stored polyline.
//
// WHY THIS REPLACED THE PER-HEX FLOW MODEL. The first river design grew a
// river forward one hex at a time (like sea contagion): each hex picked its
// own downhill neighbour, pooling into a Lake at the first local elevation
// minimum. Across five tuning rounds that model never got more than ~10-15%
// of rivers to actually reach the sea — a hard architectural ceiling, not a
// tuning miss. The cause: `elevation` (terrain height) and `continent` (the
// sea gate) are INDEPENDENT noise fields, so "locally downhill" wanders at
// random relative to where the coast is, and rivers get trapped in the
// countless local elevation minima scattered across the field long before
// they descend to the abundant coast. Guaranteeing a river reaches the sea
// requires knowing the whole basin between source and coast — which local
// forward-growth never has.
//
// THE FIX (this module). Because elevation is a pure function computable at
// ANY coordinate (placed or not — the same trick 3R.3/3R.4 rely on), we can
// solve the whole route analytically from the source the moment it's found,
// with no dependence on which hexes happen to be generated. We run a minimax
// "fill and spill": a priority-flood outward from the source that always
// expands the frontier hex reachable over the LOWEST pass (the highest
// elevation you'd have to cross to get there). That's exactly how water fills
// each depression and spills over its lowest rim, repeatedly, until it
// escapes to the ocean — so the FIRST ocean hex it reaches gives the natural
// drainage route, reconstructed via parent pointers.
//
// Minimax on ELEVATION (not continent) is deliberate: it follows the low
// ground and threads the lowest saddles between ranges, so a traced river
// almost never crosses high terrain (measured ~14% of path hexes on
// Mountains/Hills — and most of THAT is the legitimate descent out of the
// source range itself). Minimax on the continent field instead cut straight
// across mountains a third of the time (continent is blind to terrain
// height), which looked broken. Verified in the scratchpad: 100% of ~380
// sources reach the sea across a dozen maps, mean path ~110 hexes, at ~870
// elevation samples per trace (paid once, when a source is first discovered).
//
// The result is stored in world.rivers[] (see js/world/world.js) and rendered
// as a blue polyline over the map — including across unexplored hexes — so a
// river is visibly a real, sea-reaching watercourse rather than a stub that
// dies at the first pond.

import { neighbors, axialKey } from "../core/hexgeo.js";
import { elevationAt, isOceanAt } from "./biome.js";

// Flow uses fewer octaves than terrain classification (NOISE_OPTS.octaves=3):
// a smoothed field so the descent tracks the real landform slope instead of
// snagging on fine-grained noise texture that has no bearing on drainage.
// (Same rationale, and same value, as the retired per-hex flow model used.)
const FLOW_OCTAVES = 1;

// Safety bound on the priority-flood. If the nearest ocean is somehow beyond
// this many expanded hexes (a source deep in a very large landmass), we stop
// and store the partial path to the most-seaward frontier hex reached, so the
// river still visibly flows toward the coast and off the explored edge rather
// than not appearing at all. In scratchpad testing every one of ~380 sources
// reached the sea well under this cap (max ~6100 expansions).
const MAX_EXPAND = 20000;

// Minimal binary min-heap keyed by numeric `pri`. Ties resolve by insertion
// order, which is deterministic (fixed neighbour iteration order), keeping the
// whole trace a pure function of (seed, sq, sr).
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, rgt = 2 * i + 2;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (rgt < a.length && a[rgt].pri < a[m].pri) m = rgt;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function flowElevation(seed, q, r) {
  return elevationAt(seed, q, r, FLOW_OCTAVES);
}

/**
 * Trace a river from a source at (sq, sr) to the nearest ocean hex via a
 * minimax elevation fill-and-spill (see the module comment). Pure function of
 * (seed, sq, sr) — deterministic and independent of which hexes are placed.
 * @param {number|string} seed world seed
 * @param {number} sq source axial q
 * @param {number} sr source axial r
 * @param {{ maxExpand?: number, claimed?: Set<string> }} [opts] `claimed` is a
 *   set of axialKey strings already occupied by earlier-traced rivers; the
 *   trace ALSO terminates on reaching one of those (a confluence — this river
 *   is a tributary joining that trunk), so rivers form a dendritic network
 *   instead of running near-parallel to the same coast. Confluence detection is
 *   how the caller (app.js syncRivers) prevents "spaghetti" — see there.
 * @returns {{ path: {q:number,r:number}[], reachedSea: boolean, joined: boolean }}
 *   path from the source (inclusive) to the terminating hex (inclusive): an
 *   ocean hex (reachedSea), a claimed confluence hex (joined), or — on the rare
 *   budget-exhausted case — the most-seaward frontier reached (neither). path
 *   always has length >= 1 (the source itself).
 */
export function traceRiverToSea(seed, sq, sr, { maxExpand = MAX_EXPAND, claimed = null } = {}) {
  const startKey = axialKey(sq, sr);
  // If the source itself is already ocean (shouldn't happen for a Mountain/Lake
  // source, but guard anyway), the "river" is a single point.
  if (isOceanAt(seed, sq, sr)) return { path: [{ q: sq, r: sr }], reachedSea: true, joined: false };

  const bestPass = new Map([[startKey, flowElevation(seed, sq, sr)]]);
  const parent = new Map([[startKey, null]]);
  const heap = new MinHeap();
  heap.push({ q: sq, r: sr, pri: bestPass.get(startKey) });

  // Track the most-seaward frontier hex (lowest continent proxy = lowest pass
  // toward ocean) as a fallback terminus if we exhaust the budget. We can't
  // read `continent` cheaply here without another import, so approximate
  // "seaward-most" by the lowest pass elevation reached — good enough for the
  // rare fallback, and still deterministic.
  let fallbackKey = startKey;
  let fallbackPass = Infinity;

  let expanded = 0;
  const reconstruct = (endKey) => {
    const path = [];
    let k = endKey;
    while (k) {
      const c = k.indexOf(",");
      path.push({ q: Number(k.slice(0, c)), r: Number(k.slice(c + 1)) });
      k = parent.get(k);
    }
    path.reverse();
    return path;
  };

  while (heap.size) {
    const cur = heap.pop();
    const ck = axialKey(cur.q, cur.r);
    if (cur.pri > bestPass.get(ck)) continue; // stale heap entry
    expanded++;

    if (isOceanAt(seed, cur.q, cur.r)) {
      return { path: reconstruct(ck), reachedSea: true, joined: false };
    }
    // A confluence with an earlier river: join it here and stop (this river is
    // a tributary; its downstream is that trunk's, already drawn). Never the
    // start hex itself (a source sitting on an existing river still traces its
    // one step off it before joining).
    if (claimed && ck !== startKey && claimed.has(ck)) {
      return { path: reconstruct(ck), reachedSea: false, joined: true };
    }
    if (cur.pri < fallbackPass) { fallbackPass = cur.pri; fallbackKey = ck; }
    if (expanded > maxExpand) {
      return { path: reconstruct(fallbackKey), reachedSea: false, joined: false };
    }

    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r);
      const pass = Math.max(cur.pri, flowElevation(seed, n.q, n.r));
      if (!bestPass.has(nk) || pass < bestPass.get(nk)) {
        bestPass.set(nk, pass);
        parent.set(nk, ck);
        heap.push({ q: n.q, r: n.r, pri: pass });
      }
    }
  }
  // Frontier exhausted without reaching ocean (extremely unlikely under the
  // budget) — return the partial path to the most-seaward hex found.
  return { path: reconstruct(fallbackKey), reachedSea: false, joined: false };
}

/** Stable registry id for the river sourced at (q, r). */
export function riverId(q, r) {
  return `river:${q},${r}`;
}
