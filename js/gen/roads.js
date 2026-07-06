// Roads (Phase 3R.7) — a gravity-weighted trunk network over the affinity
// terrain. Roads are a DERIVED overlay (world.roads[]), the sibling of the river
// overlay (js/gen/rivers.js): recomputed from the currently-revealed terrain +
// settlements whenever the world grows, and rendered as tan polylines
// (js/ui/map.js drawRoads).
//
// The model is "rivers, one level up":
//   1. The big settlements (Town/City) are the network's nodes; roads join them
//      into a spanning forest. Whether a given pair links is a TERRAIN question,
//      not a distance one — see (3).
//   2. Terrain is the routing cost (no elevation): plains cheap, hills/forest
//      moderate, mountains DEAR (a road routes AROUND a range unless cutting
//      through is genuinely cheaper), desert VERY dear (roads almost never), and
//      sea/lake impassable (roads stop at the coast — bridges/ports come later).
//      River-adjacent hexes get a discount, so roads hug valleys and cross at
//      fords. The least-cost path's total cost is the link's "effective distance".
//   3. A link is PRACTICAL only if that effective distance stays under a cap: on
//      open ground effDist ~= the hex distance so the big places connect, but a
//      mountain wall or desert inflates it past the cap and the link fails ("act
//      as though further away"). Practical links are committed as a MINIMUM-
//      SPANNING FOREST (union-find) — best-first by a gravity weight, adding an
//      edge only when it joins two unconnected components — so the result is a
//      clean trunk skeleton, never a parallel-road mesh. Gravity (sizeA*sizeB /
//      effDist^k) only ORDERS the forest and picks road tiers.
//
// APPEND-ONLY like rivers: every road already on the world is kept verbatim and
// only NEW links are added (a road must never re-route when more terrain is
// revealed). Order-dependent by design, like the terrain and rivers it sits on.

import { neighbors, axialKey, parseKey, axialDistance } from "../core/hexgeo.js";
import { MinHeap } from "../core/minheap.js";

const WATER = new Set(["Sea", "Lake"]);

// Cost to ENTER a hex when routing a road. Plains cheap; hills/forest moderate;
// mountains dear (routed around a range unless cutting through is cheaper);
// desert very dear (roads almost never cross it). Sea/Lake are impassable.
const ROAD_COST = { Plains: 1, Forest: 2, Hills: 3, Swamp: 4, Mountains: 8, Desert: 10 };
const DEFAULT_COST = 3;
const PLAINS_COST = 1;        // the "one flat hex" unit; effDist = pathCost / this
const RIVER_DISCOUNT = 0.6;   // river-adjacent hexes are cheaper -> roads hug valleys
// Cheapest possible step (plains, discounted) — an admissible A* heuristic unit.
const H_UNIT = PLAINS_COST * RIVER_DISCOUNT;

// The trunk connects the big places into a spanning forest. Two gates decide it:
//   1. ROUTE PRACTICALITY — a link is only built if its least-cost route's
//      effective distance (pathCost / PLAINS_COST) is <= MAX_EFF_DIST. On open
//      terrain effDist ~= the hex distance, so nearby-ish big places always link;
//      a mountain range or desert inflates effDist past the cap (the road routes
//      AROUND if the detour stays under the cap, else the link fails — "act as
//      though further away"), and water is simply unreachable. This is the terrain
//      gate the doc calls for.
//   2. NO MESH — a threshold-gated minimum-spanning forest (union-find) only adds
//      an edge that joins two so-far-unconnected components, so the result is a
//      clean tree, never parallel roads.
// Gravity desirability (sizeA*sizeB / effDist^k) doesn't gate anything; it just
// ORDERS the spanning forest (bigger, closer links chosen first) and picks tiers.
const SIZE_WEIGHT = { Hamlet: 1, Village: 2, Town: 4, City: 7 };
const GRAVITY_K = 2;          // distance falloff for the MST ordering weight
const MAX_EFF_DIST = 16;      // a link's route may cost at most this (in flat-hex units)
const MAX_LINK_DIST = 14;     // straight-line prefilter (hexes) before routing
const TRUNK_SIZES = new Set(["Town", "City"]); // a trunk link joins two large places
                                               // (Villages/Hamlets are pulled in by spurs)

/** Enter-cost of the hex at `key`: terrain cost, discounted along river valleys;
 *  Infinity for unplaced or water (impassable). */
function hexCost(key, terrainByKey, riverAdj) {
  const t = terrainByKey.get(key);
  if (t === undefined || WATER.has(t)) return Infinity;
  const base = ROAD_COST[t] ?? DEFAULT_COST;
  return riverAdj.has(key) ? base * RIVER_DISCOUNT : base;
}

/**
 * A* least-cost path from (aq,ar) to (bq,br) over placed land hexes. Returns
 * `{ path: [{q,r}...] (a-first, inclusive), cost }` or null if b is unreachable
 * (e.g. across the sea). Start hex is free; each entered hex pays its `hexCost`.
 */
function routeRoad(aq, ar, bq, br, terrainByKey, riverAdj) {
  const startK = axialKey(aq, ar), goalK = axialKey(bq, br);
  if (terrainByKey.get(startK) === undefined || terrainByKey.get(goalK) === undefined) return null;
  const g = new Map([[startK, 0]]);
  const came = new Map();
  const closed = new Set();
  const heap = new MinHeap();
  heap.push({ q: aq, r: ar, d: axialDistance(aq, ar, bq, br) * H_UNIT });
  while (heap.size) {
    const cur = heap.pop();
    const ck = axialKey(cur.q, cur.r);
    if (ck === goalK) break;
    if (closed.has(ck)) continue;
    closed.add(ck);
    const gc = g.get(ck);
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r);
      if (closed.has(nk)) continue;
      const step = hexCost(nk, terrainByKey, riverAdj);
      if (!isFinite(step)) continue; // impassable (water/unplaced)
      const ng = gc + step;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, ck);
        heap.push({ q: n.q, r: n.r, d: ng + axialDistance(n.q, n.r, bq, br) * H_UNIT });
      }
    }
  }
  if (!g.has(goalK)) return null;
  const path = [];
  for (let k = goalK; k !== undefined; k = came.get(k)) {
    const { q, r } = parseKey(k);
    path.push({ q, r });
    if (k === startK) break;
  }
  path.reverse();
  return { path, cost: g.get(goalK) };
}

// Canonical endpoint order (by axial key string) so a link's id and stored a/b
// don't depend on which way round the pair was considered.
function ordered(a, b) { return a.key <= b.key ? [a, b] : [b, a]; }
function roadId(a, b) { const [x, y] = ordered(a, b); return `road:${x.q},${x.r}-${y.q},${y.r}`; }

// Tier from the endpoints: a link touching a City is a highway (1) — cities are
// the hubs — anything else (Town–Town) is a road (2). Spurs (3) are a later pass.
function tierFor(a, b) { return a.size === "City" || b.size === "City" ? 1 : 2; }

/**
 * Extend the road network over the currently-revealed hexes. Append-only: every
 * road in `existingRoads` is kept; only new trunk links are added.
 * @param {number|string} seed world seed (reserved; routing is deterministic without it)
 * @param {Map<string,string>} terrainByKey axialKey -> terrain for every placed hex
 * @param {Map<string,string>} settlementsByKey axialKey -> settlement size
 * @param {{path:{q:number,r:number}[]}[]} [rivers] world.rivers, for the valley discount
 * @param {object[]} [existingRoads] roads already on the world; kept verbatim
 * @returns {{id:string,a:{q,r},b:{q,r},tier:number,path:{q,r}[]}[]}
 */
export function computeRoads(seed, terrainByKey, settlementsByKey, rivers = [], existingRoads = []) {
  // River-adjacency set (on-path + neighbours) for the valley-hug discount.
  const riverAdj = new Set();
  for (const rv of rivers || []) for (const p of rv.path || []) {
    riverAdj.add(axialKey(p.q, p.r));
    for (const n of neighbors(p.q, p.r)) riverAdj.add(axialKey(n.q, n.r));
  }

  const nodes = [];
  for (const [key, size] of settlementsByKey) { const { q, r } = parseKey(key); nodes.push({ key, q, r, size }); }

  // Union-find over settlement keys, seeded from the frozen existing roads.
  const parent = new Map(nodes.map((n) => [n.key, n.key]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const roads = [];
  const seenIds = new Set();
  for (const rd of existingRoads || []) {
    if (seenIds.has(rd.id)) continue;
    roads.push(rd); seenIds.add(rd.id);
    const ak = axialKey(rd.a.q, rd.a.r), bk = axialKey(rd.b.q, rd.b.r);
    if (parent.has(ak) && parent.has(bk)) union(ak, bk);
  }

  // Candidate trunk pairs: at least one Town/City, within the prefilter radius.
  const scored = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    if (!TRUNK_SIZES.has(a.size) || !TRUNK_SIZES.has(b.size)) continue; // trunk = large↔large
    const d = axialDistance(a.q, a.r, b.q, b.r);
    if (d === 0 || d > MAX_LINK_DIST) continue;
    const route = routeRoad(a.q, a.r, b.q, b.r, terrainByKey, riverAdj);
    if (!route) continue; // unreachable (e.g. across the sea)
    const effDist = route.cost / PLAINS_COST;
    if (effDist > MAX_EFF_DIST) continue; // impractical route (mountains / desert / long detour)
    const w = (SIZE_WEIGHT[a.size] * SIZE_WEIGHT[b.size]) / (effDist ** GRAVITY_K); // MST ordering only
    scored.push({ a, b, route, w, id: roadId(a, b) });
  }
  // Best-first, deterministic (desirability desc, then id).
  scored.sort((x, y) => (y.w - x.w) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  // Threshold-gated MST forest: commit a link only when it joins two components.
  for (const s of scored) {
    if (seenIds.has(s.id)) continue;
    const ak = s.a.key, bk = s.b.key;
    if (find(ak) === find(bk)) continue; // already connected -> skip (no cycle, no mesh)
    union(ak, bk);
    const [A, B] = ordered(s.a, s.b);
    const path = A === s.a ? s.route.path : [...s.route.path].reverse();
    roads.push({ id: s.id, a: { q: A.q, r: A.r }, b: { q: B.q, r: B.r }, tier: tierFor(A, B), path });
    seenIds.add(s.id);
  }
  return roads;
}
