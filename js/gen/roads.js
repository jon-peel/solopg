// Roads (Phase 3R.7) — a settlement road network over the affinity terrain.
// Roads are a DERIVED overlay (world.roads[]), the sibling of the river overlay
// (js/gen/rivers.js): recomputed from the currently-revealed terrain + settlements
// whenever the world grows, and rendered as tiered tan polylines (map.js drawRoads).
//
// Two phases:
//   1. TRUNK — the big settlements (Town/City) are joined into a MINIMUM-SPANNING
//      FOREST (Kruskal + union-find over least-cost routes). This GUARANTEES that
//      every big place within reach of another ends up in ONE connected network —
//      three nearby cities are always joined (as a chain / crossroads), never left
//      as separate islands. City links reach across a continent; Town links less
//      far. Cities reliably connect (no isolation roll on the trunk).
//   2. SPURS — every other settlement (a Village/Hamlet, or a Town too remote to
//      make the trunk) attaches to the NEAREST thing it can reach — an existing
//      road hex (a crossroad) or another settlement — within a size-scaled reach.
//      Small places have a small isolation roll (most get a road, some don't), and
//      a remote one out of reach is simply left roadless.
//
// Terrain is the routing cost (no elevation): plains cheap, hills/forest moderate,
// mountains DEAR (a road routes AROUND a range unless cutting through is cheaper),
// desert VERY dear, sea/lake impassable (roads stop at the coast). River-adjacent
// hexes get a discount, so roads hug valleys and cross at fords.
//
// APPEND-ONLY: every road already on the world is kept VERBATIM — an established
// road never re-routes when new settlements/rivers appear (mirrors the rivers
// rule). Each call only ADDS roads to connect newly-revealed settlements onto the
// frozen network; the connected components of the existing roads seed the trunk
// union-find so no redundant parallel road is added. A fresh world (no existing
// roads) derives the whole network at once, as before.

import { neighbors, axialKey, parseKey, axialDistance, axialLine } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";
import { MinHeap } from "../core/minheap.js";

const WATER = new Set(["Sea", "Lake"]);

// Cost to ENTER a hex when routing a road. Plains cheap; hills/forest moderate;
// mountains dear (routed around a range unless cutting through is cheaper);
// desert very dear (roads almost never cross it). Sea/Lake are impassable.
const ROAD_COST = { Plains: 1, Forest: 2, Hills: 3, Swamp: 4, Mountains: 8, Desert: 10 };
const DEFAULT_COST = 3;
const RIVER_DISCOUNT = 0.6; // river-adjacent hexes are cheaper -> roads hug valleys
// An already-built road hex is cheap to travel, so a new road MERGES onto it and
// shares the corridor rather than running parallel (double roads become one).
const ROAD_REUSE_COST = 0.3;
const H_UNIT = ROAD_REUSE_COST; // cheapest possible step -> admissible A* heuristic unit

const SIZE_RANK = { Hamlet: 0, Village: 1, Town: 2, City: 3 };
const BIG = new Set(["Town", "City"]); // trunk anchors
// Max route cost a big-settlement trunk link will span, by the pair's makeup —
// cities wire up over long distances, towns less far.
function trunkReach(sizeA, sizeB) {
  if (sizeA === "City" && sizeB === "City") return 64;
  if (sizeA === "City" || sizeB === "City") return 48;
  return 30; // Town–Town
}
// Max route cost a spur will build to reach the network, by the owner's size.
const REACH = { City: 64, Town: 34, Village: 12, Hamlet: 8 };
// A small place occasionally has no road at all — most do, but the gap is
// interesting. Big places don't roll (the trunk connects them reliably).
const ISO_CHANCE = { Village: 0.12, Hamlet: 0.18 };
// Render tier from the road's OWNER: a city's road is a highway, a town's a road,
// a village's/hamlet's a track (dashed = ford).
const TIER = { City: 1, Town: 2, Village: 3, Hamlet: 3 };

// Ancient desert roads — a rare dead-straight relic that ignores terrain cost and
// cuts across the sands where a normal road would never go.
const ANCIENT_MAX = 18;       // max straight-line length (hexes) for one
const ANCIENT_MIN_DESERT = 3; // must genuinely cross the sands
const ANCIENT_CHANCE = 0.14;  // rare, per qualifying big-settlement pair

/**
 * Seed the trunk union-find from the CONNECTED COMPONENTS of the existing road
 * graph, so append-only re-derivation doesn't add a redundant new trunk edge
 * between big settlements that a frozen road already connects (possibly through
 * a junction). Flood-fills the road-hex graph; unions the settlement keys found
 * in each component. Pure over its args (mutates the caller's union-find).
 */
function seedNetworkComponents(existingRoads, allSettle, parent, union) {
  const roadHexSet = new Set();
  for (const rd of existingRoads) for (const p of rd.path || []) roadHexSet.add(axialKey(p.q, p.r));
  const visited = new Set();
  for (const startK of roadHexSet) {
    if (visited.has(startK)) continue;
    const stack = [startK];
    visited.add(startK);
    const settlesInComp = [];
    while (stack.length) {
      const k = stack.pop();
      if (allSettle.has(k)) settlesInComp.push(k);
      const { q, r } = parseKey(k);
      for (const n of neighbors(q, r)) {
        const nk = axialKey(n.q, n.r);
        if (roadHexSet.has(nk) && !visited.has(nk)) { visited.add(nk); stack.push(nk); }
      }
    }
    for (let i = 1; i < settlesInComp.length; i++) union(settlesInComp[0], settlesInComp[i]);
  }
}

/** Enter-cost of the hex at `key`: cheap if it's already a road (so roads merge),
 *  else terrain cost discounted along river valleys; Infinity for unplaced/water. */
function hexCost(key, terrainByKey, riverAdj, roadHexes) {
  const t = terrainByKey.get(key);
  if (t === undefined || WATER.has(t)) return Infinity;
  if (roadHexes && roadHexes.has(key)) return ROAD_REUSE_COST;
  const base = ROAD_COST[t] ?? DEFAULT_COST;
  return riverAdj.has(key) ? base * RIVER_DISCOUNT : base;
}

/**
 * A* least-cost route between two points over placed land hexes. Returns
 * `{ path: [{q,r}...] (a-first, inclusive), cost }` or null if unreachable.
 */
function routeBetween(aq, ar, bq, br, terrainByKey, riverAdj, roadHexes) {
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
      const step = hexCost(nk, terrainByKey, riverAdj, roadHexes);
      if (!isFinite(step)) continue;
      const ng = gc + step;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); heap.push({ q: n.q, r: n.r, d: ng + axialDistance(n.q, n.r, bq, br) * H_UNIT }); }
    }
  }
  if (!g.has(goalK)) return null;
  const path = [];
  for (let k = goalK; k !== undefined; k = came.get(k)) { const { q, r } = parseKey(k); path.push({ q, r }); if (k === startK) break; }
  path.reverse();
  return { path, cost: g.get(goalK) };
}

/**
 * Least-cost route OUTWARD from (sq,sr) to the nearest hex satisfying `isTarget`
 * (an existing road hex or an eligible settlement), Dijkstra over placed land
 * hexes, giving up past `maxCost`. Returns `{ path, attachKey, cost }` or null.
 */
function attachToNetwork(sq, sr, isTarget, terrainByKey, riverAdj, roadHexes, maxCost) {
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
    if (gc > maxCost) break;
    if (ck !== startK && isTarget(ck)) {
      const path = [];
      for (let k = ck; k !== undefined; k = came.get(k)) { const { q, r } = parseKey(k); path.push({ q, r }); if (k === startK) break; }
      path.reverse();
      return { path, attachKey: ck, cost: gc };
    }
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r);
      if (closed.has(nk)) continue;
      const step = hexCost(nk, terrainByKey, riverAdj, roadHexes);
      if (!isFinite(step)) continue;
      const ng = gc + step;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); heap.push({ q: n.q, r: n.r, d: ng }); }
    }
  }
  return null;
}

const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function trunkId(a, b) { return a.key <= b.key ? `road:${a.q},${a.r}-${b.q},${b.r}` : `road:${b.q},${b.r}-${a.q},${a.r}`; }

/**
 * (Re)build the road network. GM-drawn MANUAL roads in `existingRoads` are kept;
 * the auto network is re-derived from the current terrain + settlements.
 * @param {number|string} seed world seed (drives the spur isolation roll)
 * @param {Map<string,string>} terrainByKey axialKey -> terrain for every placed hex
 * @param {Map<string,string>} settlementsByKey axialKey -> settlement size
 * @param {{path:{q:number,r:number}[]}[]} [rivers] world.rivers, for the valley discount
 * @param {object[]} [existingRoads] roads already on the world; MANUAL ones kept verbatim
 * @returns {{id:string,a:{q,r},b:{q,r},tier:number,path:{q,r}[],junction:boolean}[]}
 */
export function computeRoads(seed, terrainByKey, settlementsByKey, rivers = [], existingRoads = []) {
  const riverAdj = new Set();
  for (const rv of rivers || []) for (const p of rv.path || []) {
    riverAdj.add(axialKey(p.q, p.r));
    for (const n of neighbors(p.q, p.r)) riverAdj.add(axialKey(n.q, n.r));
  }

  const nodes = [], bigNodes = [], allSettle = new Set();
  const parent = new Map(); // settlement-key union-find for the trunk MST
  for (const [key, size] of settlementsByKey) {
    allSettle.add(key);
    parent.set(key, key);
    const { q, r } = parseKey(key);
    const n = { key, q, r, size };
    nodes.push(n);
    if (BIG.has(size)) bigNodes.push(n);
  }
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const roads = [];
  const seenIds = new Set();
  const networkHexes = new Set();
  // Hexes already carrying a road — cheap to route through, so later roads merge
  // onto them instead of running parallel (see hexCost / ROAD_REUSE_COST).
  const roadHexes = new Set();
  const addRoadHexes = (path) => { for (const p of path) { const k = axialKey(p.q, p.r); networkHexes.add(k); roadHexes.add(k); } };

  // APPEND-ONLY (mirrors the rivers rule — see js/gen/rivers.js): keep EVERY
  // existing road verbatim (manual AND auto), so an established road NEVER
  // re-routes when new settlements or rivers appear. They seed the network (new
  // roads merge onto them via the reuse discount). Then the CONNECTED COMPONENTS
  // of the existing road graph seed the union-find, so already-connected big
  // settlements don't get a redundant new trunk edge, and settlements already on
  // a road are skipped by the spur phase.
  for (const rd of existingRoads || []) {
    if (seenIds.has(rd.id)) continue;
    roads.push(rd); seenIds.add(rd.id);
    addRoadHexes(rd.path || []);
  }
  seedNetworkComponents(existingRoads || [], allSettle, parent, union);

  // --- Phase 1: trunk MST over big settlements (Kruskal) ---------------------
  // Edge weights use the independent (no-reuse) route cost, so the tree is chosen
  // by real terrain distance; committed edges are then RE-ROUTED with the growing
  // roadHexes discount so they merge onto the trunk built so far.
  const edges = [];
  for (let i = 0; i < bigNodes.length; i++) for (let j = i + 1; j < bigNodes.length; j++) {
    const a = bigNodes[i], b = bigNodes[j];
    const reach = trunkReach(a.size, b.size);
    if (axialDistance(a.q, a.r, b.q, b.r) > reach) continue; // prune (cost >= axial distance)
    const route = routeBetween(a.q, a.r, b.q, b.r, terrainByKey, riverAdj, null);
    if (!route || route.cost > reach) continue;
    edges.push({ a, b, cost: route.cost, id: trunkId(a, b) });
  }
  edges.sort((x, y) => (x.cost - y.cost) || cmpKey(x.id, y.id));
  for (const e of edges) {
    if (find(e.a.key) === find(e.b.key)) continue; // already connected -> no cycle, no mesh
    union(e.a.key, e.b.key);
    // Bigger endpoint owns/orients the road (a-first). Re-route with reuse so it
    // shares the corridor with earlier trunk roads.
    const owner = SIZE_RANK[e.a.size] >= SIZE_RANK[e.b.size] ? e.a : e.b;
    const other = owner === e.a ? e.b : e.a;
    const rr = routeBetween(owner.q, owner.r, other.q, other.r, terrainByKey, riverAdj, roadHexes);
    if (!rr) continue;
    roads.push({
      id: e.id, a: { q: owner.q, r: owner.r }, b: { q: other.q, r: other.r },
      tier: (owner.size === "City" || other.size === "City") ? 1 : 2, path: rr.path, junction: false,
    });
    seenIds.add(e.id);
    addRoadHexes(rr.path);
  }

  // --- Phase 2: spurs — attach every remaining settlement to the network ------
  const order = [...nodes].sort((a, b) => (SIZE_RANK[b.size] - SIZE_RANK[a.size]) || cmpKey(a.key, b.key));
  for (const S of order) {
    if (networkHexes.has(S.key)) continue; // already on the network (trunk / a road runs through)
    const id = `spur:${S.q},${S.r}`;
    if (seenIds.has(id)) continue;
    // Big places skip the isolation roll (they should reliably connect).
    if (!BIG.has(S.size) && subRng(seed, "road-iso", S.q, S.r)() < (ISO_CHANCE[S.size] ?? 0.12)) continue;
    const reach = REACH[S.size] ?? 12;
    // Prefer joining the existing road NETWORK (so it stays connected to the trunk,
    // and its route can reuse a nearby road) — only fall back to the nearest
    // settlement when no road is in reach (a remote local link).
    let res = attachToNetwork(S.q, S.r, (k) => k !== S.key && networkHexes.has(k), terrainByKey, riverAdj, roadHexes, reach);
    if (!res) res = attachToNetwork(S.q, S.r, (k) => k !== S.key && allSettle.has(k), terrainByKey, riverAdj, roadHexes, reach);
    if (!res) continue; // nothing reachable within reach -> isolated (remote)
    const b = parseKey(res.attachKey);
    roads.push({
      id, a: { q: S.q, r: S.r }, b: { q: b.q, r: b.r },
      tier: TIER[S.size] ?? 3, path: res.path, junction: !allSettle.has(res.attachKey),
    });
    seenIds.add(id);
    addRoadHexes(res.path);
  }

  // --- Ancient desert roads: a rare dead-straight relic across the sands -------
  for (let i = 0; i < bigNodes.length; i++) for (let j = i + 1; j < bigNodes.length; j++) {
    const a = bigNodes[i], b = bigNodes[j];
    if (axialDistance(a.q, a.r, b.q, b.r) > ANCIENT_MAX) continue;
    const line = axialLine(a.q, a.r, b.q, b.r);
    let desert = 0, ok = true;
    for (const p of line) {
      const t = terrainByKey.get(axialKey(p.q, p.r));
      if (t === undefined || WATER.has(t)) { ok = false; break; } // unrevealed / crosses water
      if (t === "Desert") desert++;
    }
    if (!ok || desert < ANCIENT_MIN_DESERT) continue;
    const [k1, k2] = a.key <= b.key ? [a.key, b.key] : [b.key, a.key];
    const id = `ancient:${k1}-${k2}`;
    if (seenIds.has(id)) continue;
    if (subRng(seed, "ancient", k1, k2)() >= ANCIENT_CHANCE) continue;
    roads.push({ id, a: { q: a.q, r: a.r }, b: { q: b.q, r: b.r }, tier: 2, kind: "ancient", path: line, junction: false });
    seenIds.add(id);
    addRoadHexes(line);
  }
  return roads;
}

/**
 * Build a manual (GM-drawn) road from an ordered chain of hexes. Manual roads are
 * kept verbatim by computeRoads (never re-routed) and seed the auto network — a
 * settlement can spur onto one at a crossroad. Rendered as a solid tier-2 road.
 * @param {string} id stable unique id for this road
 * @param {{q:number,r:number}[]} drawnPath ordered, connected chain of hexes
 * @returns {{id:string,manual:true,a:{q,r},b:{q,r},tier:number,path:{q,r}[],junction:boolean}}
 */
export function buildManualRoad(id, drawnPath) {
  const path = drawnPath.map((p) => ({ q: p.q, r: p.r }));
  const a = path[0], b = path[path.length - 1];
  return { id, manual: true, a: { q: a.q, r: a.r }, b: { q: b.q, r: b.r }, tier: 2, path, junction: false };
}
