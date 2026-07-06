// Roads (Phase 3R.7) — a settlement road network over the affinity terrain.
// Roads are a DERIVED overlay (world.roads[]), the sibling of the river overlay
// (js/gen/rivers.js): recomputed from the currently-revealed terrain + settlements
// whenever the world grows, and rendered as tiered tan polylines (map.js drawRoads).
//
// GREEDY NEAREST-ATTACHMENT model — "civilisation reaches out to the network it
// can already see":
//   - Process settlements BIGGEST first (Cities, then Towns, then Villages,
//     Hamlets). Each one that isn't already on the network builds ONE road to the
//     nearest thing it can reach — a least-cost route (A* / Dijkstra over the
//     terrain cost field) to the closest hex that is either an existing ROAD
//     (a crossroad) or another eligible SETTLEMENT.
//   - Because the big places go first, cities wire up to cities over long
//     distances (a road can span the map), towns then hang off that trunk —
//     usually joining it at a crossroad rather than running their own long haul —
//     and finally villages/hamlets spur in to whatever is nearest.
//   - REACH is size-scaled: a City reaches across a continent, a Hamlet only a few
//     hexes, so a remote small place is left roadless (interesting), and a small
//     seeded ISOLATION roll leaves the odd well-placed one unconnected too.
//   - Nodes that many others attach to (central cities/towns, crossroads) end up
//     with SEVERAL roads — the network grows hubs naturally, not a rigid tree.
//
// Terrain is the routing cost (no elevation): plains cheap, hills/forest moderate,
// mountains DEAR (a road routes AROUND a range unless cutting through is genuinely
// cheaper), desert VERY dear, sea/lake impassable (roads stop at the coast).
// River-adjacent hexes get a discount, so roads hug valleys and cross at fords.
//
// APPEND-ONLY like rivers: every road already on the world is kept verbatim and a
// settlement already on the network is never re-wired; only NEW roads are added as
// the world grows. Deterministic (fixed processing order), and order-dependent by
// design like the terrain and rivers it sits on.

import { neighbors, axialKey, parseKey } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";
import { MinHeap } from "../core/minheap.js";

const WATER = new Set(["Sea", "Lake"]);

// Cost to ENTER a hex when routing a road. Plains cheap; hills/forest moderate;
// mountains dear (routed around a range unless cutting through is cheaper);
// desert very dear (roads almost never cross it). Sea/Lake are impassable.
const ROAD_COST = { Plains: 1, Forest: 2, Hills: 3, Swamp: 4, Mountains: 8, Desert: 10 };
const DEFAULT_COST = 3;
const RIVER_DISCOUNT = 0.6; // river-adjacent hexes are cheaper -> roads hug valleys

const SIZE_RANK = { Hamlet: 0, Village: 1, Town: 2, City: 3 };
const BIG = new Set(["Town", "City"]); // trunk anchors; small places spur to any settlement
// Max route cost a settlement of each size will build to reach the network — a
// City wires up across a continent, a Hamlet only locally (so remote small places
// stay roadless).
const REACH = { City: 64, Town: 34, Village: 12, Hamlet: 8 };
// Even a well-placed settlement occasionally has no road at all — most do, but the
// gap is interesting. Small places skip more often than big ones.
const ISO_CHANCE = { City: 0.02, Town: 0.05, Village: 0.12, Hamlet: 0.18 };
// Render tier from the road's OWNER (the settlement that built it): a city's road
// is a highway, a town's a road, a village's/hamlet's a track (dashed = ford).
const TIER = { City: 1, Town: 2, Village: 3, Hamlet: 3 };

/** Enter-cost of the hex at `key`: terrain cost, discounted along river valleys;
 *  Infinity for unplaced or water (impassable). */
function hexCost(key, terrainByKey, riverAdj) {
  const t = terrainByKey.get(key);
  if (t === undefined || WATER.has(t)) return Infinity;
  const base = ROAD_COST[t] ?? DEFAULT_COST;
  return riverAdj.has(key) ? base * RIVER_DISCOUNT : base;
}

/**
 * Least-cost route from (sq,sr) OUTWARD to the nearest hex satisfying `isTarget`
 * (an existing road hex or an eligible settlement), Dijkstra over placed land
 * hexes, giving up once the cheapest reachable target would cost more than
 * `maxCost`. Returns `{ path: [{q,r}...] (source-first, inclusive of the attach
 * hex), attachKey, cost }` or null if nothing is in reach.
 */
function attachToNetwork(sq, sr, isTarget, terrainByKey, riverAdj, maxCost) {
  const startK = axialKey(sq, sr);
  const g = new Map([[startK, 0]]);
  const came = new Map();
  const closed = new Set();
  const heap = new MinHeap();
  heap.push({ q: sq, r: sr, d: 0 });
  while (heap.size) {
    const cur = heap.pop();
    const ck = axialKey(cur.q, cur.r);
    if (closed.has(ck)) continue;
    closed.add(ck);
    const gc = g.get(ck);
    if (gc > maxCost) break; // nearest reachable target is beyond this size's reach
    if (ck !== startK && isTarget(ck)) {
      const path = [];
      for (let k = ck; k !== undefined; k = came.get(k)) { const { q, r } = parseKey(k); path.push({ q, r }); if (k === startK) break; }
      path.reverse();
      return { path, attachKey: ck, cost: gc };
    }
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r);
      if (closed.has(nk)) continue;
      const step = hexCost(nk, terrainByKey, riverAdj);
      if (!isFinite(step)) continue; // impassable (water/unplaced)
      const ng = gc + step;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); heap.push({ q: n.q, r: n.r, d: ng }); }
    }
  }
  return null;
}

/**
 * Extend the road network over the currently-revealed hexes. Append-only: every
 * road in `existingRoads` is kept; only new roads (for settlements not yet on the
 * network) are added.
 * @param {number|string} seed world seed (drives the isolation roll)
 * @param {Map<string,string>} terrainByKey axialKey -> terrain for every placed hex
 * @param {Map<string,string>} settlementsByKey axialKey -> settlement size
 * @param {{path:{q:number,r:number}[]}[]} [rivers] world.rivers, for the valley discount
 * @param {object[]} [existingRoads] roads already on the world; kept verbatim
 * @returns {{id:string,a:{q,r},b:{q,r},tier:number,path:{q,r}[],junction:boolean}[]}
 */
export function computeRoads(seed, terrainByKey, settlementsByKey, rivers = [], existingRoads = []) {
  // River-adjacency set (on-path + neighbours) for the valley-hug discount.
  const riverAdj = new Set();
  for (const rv of rivers || []) for (const p of rv.path || []) {
    riverAdj.add(axialKey(p.q, p.r));
    for (const n of neighbors(p.q, p.r)) riverAdj.add(axialKey(n.q, n.r));
  }

  // Keep existing roads verbatim; their hexes seed the network so new settlements
  // attach to them (and a settlement a road already runs through counts as on-net).
  const roads = [];
  const seenIds = new Set();
  const networkHexes = new Set();
  for (const rd of existingRoads || []) {
    if (seenIds.has(rd.id)) continue;
    roads.push(rd); seenIds.add(rd.id);
    for (const p of rd.path || []) networkHexes.add(axialKey(p.q, p.r));
  }

  // Settlement target sets: big places wire only to other big places / roads;
  // small places may spur to ANY settlement / road.
  const allSettle = new Set();
  const bigSettle = new Set();
  const nodes = [];
  for (const [key, size] of settlementsByKey) {
    allSettle.add(key);
    if (BIG.has(size)) bigSettle.add(key);
    const { q, r } = parseKey(key);
    nodes.push({ key, q, r, size });
  }
  // Biggest first, then canonical by key — deterministic processing order.
  nodes.sort((a, b) => (SIZE_RANK[b.size] - SIZE_RANK[a.size]) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  for (const S of nodes) {
    if (networkHexes.has(S.key)) continue; // already on the network (frozen / a road runs through)
    const id = `road:${S.q},${S.r}`;
    if (seenIds.has(id)) continue;
    // Occasional deliberate isolation — most places get a road, some just don't.
    if (subRng(seed, "road-iso", S.q, S.r)() < (ISO_CHANCE[S.size] ?? 0.12)) continue;
    const settleTargets = BIG.has(S.size) ? bigSettle : allSettle;
    const isTarget = (k) => k !== S.key && (networkHexes.has(k) || settleTargets.has(k));
    const res = attachToNetwork(S.q, S.r, isTarget, terrainByKey, riverAdj, REACH[S.size] ?? 12);
    if (!res) continue; // nothing reachable within reach -> isolated (remote)
    const b = parseKey(res.attachKey);
    roads.push({
      id,
      a: { q: S.q, r: S.r },
      b: { q: b.q, r: b.r },
      tier: TIER[S.size] ?? 3,
      path: res.path,
      junction: !allSettle.has(res.attachKey), // b is a mid-road crossroad, not a settlement
    });
    seenIds.add(id);
    for (const p of res.path) networkHexes.add(axialKey(p.q, p.r));
  }
  return roads;
}
