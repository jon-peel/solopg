// Rivers v2 — emergent major-water drainage over the elevation-free affinity
// terrain (Phase 3R.6). Rivers are a DERIVED overlay (world.rivers[]), not
// per-hex data: recomputed from the currently-revealed terrain whenever the
// world grows, and rendered as blue polylines (js/ui/map.js drawRivers).
//
// There's no elevation anymore, so TERRAIN itself is the routing cost — the
// insight that makes rivers work without a height field:
//
//   1. Find the connected bodies of water; a MAJOR body (a sea or a large lake,
//      size >= MAJOR_BODY_SIZE) is a real river SINK. Small ponds are NOT sinks
//      — a river flows past/through them to the coast, the way real rivers do.
//   2. Flood a cost-to-nearest-major-water field D outward from every major
//      body: cheap through swamp/plains/small-lakes, dear through hills, very
//      dear through mountains. D is "terrain as elevation" — it decreases
//      monotonically to major water, so following it downhill is guaranteed to
//      ARRIVE and never climbs a mountain.
//   3. SOURCES are mountain hexes deep in the interior (D >= MIN_SOURCE_D, a
//      local D-maximum — a watershed head) that pass a seeded density roll.
//      Because a big sea owns a big watershed, it naturally collects more
//      sources -> more (and longer) rivers, i.e. sea size drives river count,
//      with no explicit rule for it.
//   4. Each source flows DOWN D to major water; traces run in a canonical order
//      sharing one `claimed` set, so a tributary that meets an earlier river
//      JOINS it (a confluence) rather than running a parallel line.
//
// This is fork (i) from the design chat — "revealed-only": D floods from the
// major water present in the REVEALED area, so a river only forms where a
// source can actually reach a real coast/lake through already-generated hexes.
// It's order-dependent by design (like the terrain it sits on), and cheap:
// a Dijkstra + a handful of short descents over the placed hexes.

import { neighbors, axialKey, parseKey } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";

const WATER = new Set(["Sea", "Lake"]);

// A water body this big (in hexes) is a real river sink — a sea or a great
// lake. Smaller ponds are pass-through. Tuned in the scratchpad against real
// affinity output for "long cross-country rivers to the coast".
const MAJOR_BODY_SIZE = 20;

// Cost to ENTER a hex when flooding the drainage field (higher = rivers avoid
// it). Small lakes and swamp are cheap (rivers thread through wetlands); hills
// and especially mountains are dear (rivers route around highlands).
const COST = { Swamp: 1, Lake: 1, Plains: 2, Forest: 3, Desert: 5, Hills: 7, Mountains: 12 };
const DEFAULT_COST = 4;

// A source must be at least this far (in accumulated cost) from major water —
// deep interior only, so rivers are long and cross-country, not local drainage.
const MIN_SOURCE_D = 40;
// ...and pass this seeded roll, so sources are a select few watershed heads
// rather than every high peak.
const SOURCE_CHANCE = 0.7;

// Minimal binary min-heap keyed by numeric `d`.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].d <= a[i].d) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Extend the river network over the currently-revealed hexes. APPEND-ONLY:
 * every river in `existingRivers` is kept verbatim, and only NEW rivers (from
 * sources that don't already have one) are added. This is deliberate — a river
 * must never disappear or re-route when the GM reveals more terrain (revealing
 * elsewhere shifts the cost field, which would otherwise silently drop or move
 * existing rivers). New rivers still merge INTO existing ones at confluences
 * (the existing paths seed the `claimed` set).
 * @param {number|string} seed world seed
 * @param {Map<string,string>} terrainByKey axialKey -> terrain, for every
 *   placed hex (only these coordinates exist to the router).
 * @param {{ id:string, source:{q:number,r:number}, path:{q:number,r:number}[] }[]} [existingRivers]
 *   rivers already on the world; kept as-is.
 * @returns {{ id:string, source:{q:number,r:number}, path:{q:number,r:number}[], reachedWater:boolean }[]}
 *   existingRivers followed by any newly-formed ones.
 */
export function computeRivers(seed, terrainByKey, existingRivers = []) {
  const T = (q, r) => terrainByKey.get(axialKey(q, r));
  const coords = [];
  for (const key of terrainByKey.keys()) coords.push(parseKey(key));

  // 1. Water bodies + sizes -> which are MAJOR (real sinks).
  const bodyOf = new Map();
  const bodySize = new Map();
  let bid = 0;
  for (const { q, r } of coords) {
    const k = axialKey(q, r);
    if (!WATER.has(T(q, r)) || bodyOf.has(k)) continue;
    const stack = [{ q, r }]; bodyOf.set(k, bid); let size = 0;
    while (stack.length) {
      const c = stack.pop(); size++;
      for (const n of neighbors(c.q, c.r)) {
        const nk = axialKey(n.q, n.r);
        if (WATER.has(T(n.q, n.r)) && !bodyOf.has(nk)) { bodyOf.set(nk, bid); stack.push(n); }
      }
    }
    bodySize.set(bid, size); bid++;
  }
  const isMajor = (q, r) => { const b = bodyOf.get(axialKey(q, r)); return b !== undefined && bodySize.get(b) >= MAJOR_BODY_SIZE; };

  // 2. Cost-to-nearest-major-water field D (Dijkstra from every major hex).
  const D = new Map();
  const heap = new MinHeap();
  for (const { q, r } of coords) if (isMajor(q, r)) { D.set(axialKey(q, r), 0); heap.push({ q, r, d: 0 }); }
  while (heap.size) {
    const cur = heap.pop(); const ck = axialKey(cur.q, cur.r);
    if (cur.d > (D.get(ck) ?? Infinity)) continue;
    for (const n of neighbors(cur.q, cur.r)) {
      const t = T(n.q, n.r);
      if (t === undefined || isMajor(n.q, n.r)) continue; // unplaced, or don't route through major water
      const nd = cur.d + (COST[t] ?? DEFAULT_COST);
      const nk = axialKey(n.q, n.r);
      if (nd < (D.get(nk) ?? Infinity)) { D.set(nk, nd); heap.push({ q: n.q, r: n.r, d: nd }); }
    }
  }

  // Keep every existing river verbatim (append-only — see the docstring), and
  // seed the `claimed` set with their hexes so new tributaries merge into them.
  const rivers = existingRivers.slice();
  const existingIds = new Set(existingRivers.map((rv) => rv.id));
  const claimed = new Set();
  for (const rv of existingRivers) for (const p of rv.path) claimed.add(axialKey(p.q, p.r));

  // 3. Sources: deep-interior Mountains that are a local D-max and pass the roll.
  // Skip any source that already has a river (its path is frozen).
  const sources = [];
  for (const { q, r } of coords) {
    if (T(q, r) !== "Mountains") continue;
    if (existingIds.has(`river:${q},${r}`)) continue;
    const d = D.get(axialKey(q, r));
    if (d === undefined || d < MIN_SOURCE_D) continue;
    if (!neighbors(q, r).every((n) => (D.get(axialKey(n.q, n.r)) ?? -1) <= d)) continue;
    if (subRng(seed, "river-src", q, r)() >= SOURCE_CHANCE) continue;
    sources.push({ q, r, d });
  }
  // Biggest (deepest) rivers first, so smaller tributaries merge INTO them.
  sources.sort((a, b) => (b.d - a.d) || (a.q - b.q) || (a.r - b.r));

  // 4. Trace each NEW source down D to major water, merging at confluences.
  for (const s of sources) {
    const path = [{ q: s.q, r: s.r }];
    const seen = new Set([axialKey(s.q, s.r)]);
    let cur = s; let reached = false;
    for (let step = 0; step < 1000; step++) {
      const ck = axialKey(cur.q, cur.r);
      if (step > 0 && claimed.has(ck)) { reached = true; break; } // joined a trunk
      let best = null; let bestD = D.get(ck) ?? Infinity;
      for (const n of neighbors(cur.q, cur.r)) {
        if (isMajor(n.q, n.r)) { best = { q: n.q, r: n.r, water: true }; break; }
        const nk = axialKey(n.q, n.r);
        const nd = D.get(nk);
        if (nd === undefined || seen.has(nk)) continue;
        if (nd < bestD) { bestD = nd; best = { q: n.q, r: n.r }; }
      }
      if (!best) break;
      path.push({ q: best.q, r: best.r });
      if (best.water) { reached = true; break; }
      seen.add(axialKey(best.q, best.r)); cur = best;
    }
    if (reached && path.length >= 3) {
      for (const p of path) claimed.add(axialKey(p.q, p.r));
      rivers.push({ id: `river:${s.q},${s.r}`, source: { q: s.q, r: s.r }, path, reachedWater: true });
    }
  }
  return rivers;
}
