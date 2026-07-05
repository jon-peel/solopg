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

import { neighbors, axialKey, parseKey, hexDisc, axialDistance } from "../core/hexgeo.js";
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

// --- Settlement gravity (rivers bend toward nearby settlements) --------------
// A river tracing down the cost field is nudged to pass CLOSE TO settlements: at
// each step it prefers the hex that best trades low D (still heading to water)
// against a settlement "attraction". Bigger settlements pull harder (SIZE) and
// farther (RADIUS), so when two compete a river drifts to the larger. The pull
// only ever picks among NON-CLIMBING neighbours (D not increasing), so a river
// still always reaches water — it just chooses the downhill branch (or an
// equal-cost sidestep) nearest a town. Away from settlements the attraction is
// 0 and the pick reduces to plain steepest descent (an equal-cost step can only
// win when a settlement pulls it), so unsettled country is unchanged.
const PULL_K = 4; // attraction weight vs. one unit of cost-field D (tuned in the scratchpad)
const PULL_SIZE_WEIGHT = { Thorp: 1, Hamlet: 1.5, Village: 2.5, Town: 4, City: 7 };
// Reach (hexes ≈ 6 miles each): a City (and up) pulls from a day's ride; smaller
// settlements only a couple of hexes ("a hex or two, not far out of the way").
const pullRadius = (size) => (size === "City" ? 3 : 2);

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
 * @param {Map<string,string>} [settlementsByKey] axialKey -> settlement size, for
 *   every placed settlement. Newly-traced rivers bend toward these (see the
 *   settlement-gravity note above); omit/empty for no gravity. Existing/manual
 *   rivers are frozen and never re-bent.
 * @returns {{ id:string, source:{q:number,r:number}, path:{q:number,r:number}[], reachedWater:boolean }[]}
 *   existingRivers followed by any newly-formed ones.
 */
export function computeRivers(seed, terrainByKey, existingRivers = [], settlementsByKey = new Map()) {
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

  // Keep every existing river verbatim (append-only — see the docstring). A
  // MANUAL river (GM-drawn) additionally has its still-OPEN ends completed here
  // as terrain allows: the downstream end extends by descending D to major
  // water, the upstream end by ascending D (inland) to a mountain — permanent
  // once done. Everything already drawn stays put; we only ever extend an open
  // end. Every river's hexes seed `claimed` so auto tributaries merge in.
  const rivers = existingRivers.map((rv) => (rv.manual ? completeManualRiver(rv, D, isMajor, T) : rv));
  const existingIds = new Set(rivers.map((rv) => rv.id));
  const manualSourceKeys = new Set(rivers.filter((rv) => rv.manual).map((rv) => axialKey(rv.path[0].q, rv.path[0].r)));
  const claimed = new Set();
  for (const rv of rivers) for (const p of rv.path) claimed.add(axialKey(p.q, p.r));

  // 3. Sources: deep-interior Mountains that are a local D-max and pass the roll.
  // Skip any source that already has a river (its path is frozen), including a
  // manual river's own source hex (so it doesn't spawn a duplicate auto river).
  const sources = [];
  for (const { q, r } of coords) {
    if (T(q, r) !== "Mountains") continue;
    if (existingIds.has(`river:${q},${r}`) || manualSourceKeys.has(axialKey(q, r))) continue;
    const d = D.get(axialKey(q, r));
    if (d === undefined || d < MIN_SOURCE_D) continue;
    if (!neighbors(q, r).every((n) => (D.get(axialKey(n.q, n.r)) ?? -1) <= d)) continue;
    if (subRng(seed, "river-src", q, r)() >= SOURCE_CHANCE) continue;
    sources.push({ q, r, d });
  }
  // Biggest (deepest) rivers first, so smaller tributaries merge INTO them.
  sources.sort((a, b) => (b.d - a.d) || (a.q - b.q) || (a.r - b.r));

  // Settlement attraction field A: stamp each settlement's size-weighted,
  // radius-limited bump onto the hexes around it (summed where they overlap).
  const attract = new Map();
  for (const [key, size] of settlementsByKey) {
    const w = PULL_SIZE_WEIGHT[size];
    if (!w) continue;
    const { q, r } = parseKey(key);
    const rad = pullRadius(size);
    for (const c of hexDisc(q, r, rad)) {
      const bump = w * (rad + 1 - axialDistance(q, r, c.q, c.r)); // peaks on/adjacent, linear falloff
      const ck = axialKey(c.q, c.r);
      attract.set(ck, (attract.get(ck) ?? 0) + bump);
    }
  }
  const attractionAt = (q, r) => attract.get(axialKey(q, r)) ?? 0;

  // 4. Trace each NEW source down D to major water, merging at confluences.
  // Try with settlement gravity first; if that trace fails to reach (a rare
  // dead-end on an equal-cost detour), retry with no pull (plain steepest
  // descent) so a river is never lost to the gravity bias.
  for (const s of sources) {
    let { path, reached } = traceRiver(s, D, isMajor, claimed, attractionAt, PULL_K);
    if (!reached) ({ path, reached } = traceRiver(s, D, isMajor, claimed, attractionAt, 0));
    if (reached && path.length >= 3) {
      for (const p of path) claimed.add(axialKey(p.q, p.r));
      rivers.push({ id: `river:${s.q},${s.r}`, source: { q: s.q, r: s.r }, path, reachedWater: true });
    }
  }
  return rivers;
}

// Trace one source down the cost field D to major water (or into a claimed trunk
// = a confluence), biased toward settlements by `attractionAt` scaled by pullK.
// Each step picks the unseen neighbour with D NOT ABOVE the current hex's (never
// climbs → always progresses to water) that maximizes pullK*attraction - D. With
// pullK 0 (or no settlement near) this is exactly steepest descent. Returns the
// path (source-first) and whether it reached water/a trunk.
function traceRiver(s, D, isMajor, claimed, attractionAt, pullK) {
  const path = [{ q: s.q, r: s.r }];
  const seen = new Set([axialKey(s.q, s.r)]);
  let cur = s; let reached = false;
  for (let step = 0; step < 1000; step++) {
    const ck = axialKey(cur.q, cur.r);
    if (step > 0 && claimed.has(ck)) { reached = true; break; } // joined a trunk
    const dcur = D.get(ck) ?? Infinity;
    let best = null; let bestScore = -Infinity; let water = false;
    for (const n of neighbors(cur.q, cur.r)) {
      if (isMajor(n.q, n.r)) { best = { q: n.q, r: n.r }; water = true; break; }
      const nk = axialKey(n.q, n.r);
      const nd = D.get(nk);
      if (nd === undefined || seen.has(nk) || nd > dcur) continue; // unplaced, visited, or uphill
      const score = pullK * attractionAt(n.q, n.r) - nd;
      if (score > bestScore) { bestScore = score; best = { q: n.q, r: n.r }; }
    }
    if (!best) break;
    path.push({ q: best.q, r: best.r });
    if (water) { reached = true; break; }
    seen.add(axialKey(best.q, best.r)); cur = best;
  }
  return { path, reached };
}

// Extend a manual river's still-open ends against the current cost field. Only
// ever APPENDS/PREPENDS (never shortens or re-routes the drawn hexes); returns
// the same object if nothing could be completed yet.
function completeManualRiver(rv, D, isMajor, T) {
  let path = rv.path;
  let upstreamOpen = rv.upstreamOpen;
  let downstreamOpen = rv.downstreamOpen;
  if (!upstreamOpen && !downstreamOpen) return rv;
  const occupied = new Set(path.map((p) => axialKey(p.q, p.r)));
  let changed = false;

  if (downstreamOpen) {
    const tail = path[path.length - 1];
    const ext = descendToWater(D, isMajor, tail, occupied);
    if (ext) { path = path.concat(ext); for (const e of ext) occupied.add(axialKey(e.q, e.r)); downstreamOpen = false; changed = true; }
  }
  if (upstreamOpen) {
    const head = path[0];
    const ext = ascendToMountain(D, T, head, occupied);
    if (ext) { path = ext.concat(path); upstreamOpen = false; changed = true; }
  }
  if (!changed) return rv;
  return { ...rv, path, upstreamOpen, downstreamOpen, source: { q: path[0].q, r: path[0].r }, reachedWater: !downstreamOpen };
}

// From `start`, descend the cost field to the FIRST major-water hex it can
// reach, returning the hexes to append (excluding start), or null if major
// water isn't reachable from here yet (D undefined / no descent).
function descendToWater(D, isMajor, start, occupied) {
  if (D.get(axialKey(start.q, start.r)) === undefined) return null;
  const ext = [];
  const seen = new Set(occupied);
  let cur = start;
  for (let step = 0; step < 2000; step++) {
    let best = null; let bestD = D.get(axialKey(cur.q, cur.r)) ?? Infinity; let water = null;
    for (const n of neighbors(cur.q, cur.r)) {
      if (isMajor(n.q, n.r)) { water = { q: n.q, r: n.r }; break; }
      const nk = axialKey(n.q, n.r); const nd = D.get(nk);
      if (nd === undefined || seen.has(nk)) continue;
      if (nd < bestD) { bestD = nd; best = { q: n.q, r: n.r }; }
    }
    if (water) { ext.push(water); return ext; }
    if (!best) return null;
    ext.push(best); seen.add(axialKey(best.q, best.r)); cur = best;
  }
  return null;
}

// From `start`, ascend the cost field (inland, toward higher cost) to the FIRST
// Mountains hex, returning the hexes to prepend (mountain-first ... nearest
// start), or null if no mountain is reachable this way yet (edge/unrevealed).
function ascendToMountain(D, T, start, occupied) {
  const ext = [];
  const seen = new Set(occupied);
  let cur = start;
  for (let step = 0; step < 2000; step++) {
    let best = null; let bestD = -Infinity;
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = axialKey(n.q, n.r); const nd = D.get(nk);
      if (nd === undefined || seen.has(nk)) continue; // unplaced or visited
      if (nd > bestD) { bestD = nd; best = { q: n.q, r: n.r }; }
    }
    if (!best) return null;
    ext.push(best); seen.add(axialKey(best.q, best.r)); cur = best;
    if (T(best.q, best.r) === "Mountains") { ext.reverse(); return ext; }
  }
  return null;
}

/**
 * Build a manual (GM-drawn) river from an ordered chain of hexes. Orients it so
 * path[0] is the upstream/source end and the last hex is the downstream/mouth
 * end (reversing the drawn order if it clearly runs mouth→source), and marks
 * which ends are still OPEN — i.e. not yet anchored to a mountain (upstream) or
 * to water (downstream). computeRivers completes those open ends as terrain
 * allows. The drawn hexes themselves are never moved.
 * @param {string} id stable unique id for this river
 * @param {{q:number,r:number}[]} drawnPath ordered, connected chain of hexes
 * @param {Map<string,string>} terrainByKey axialKey -> terrain
 * @returns {{ id:string, manual:true, source:{q,r}, path:{q,r}[], upstreamOpen:boolean, downstreamOpen:boolean, reachedWater:boolean }}
 */
export function buildManualRiver(id, drawnPath, terrainByKey) {
  const T = (q, r) => terrainByKey.get(axialKey(q, r));
  let path = drawnPath.map((p) => ({ q: p.q, r: p.r }));
  const firstT = T(path[0].q, path[0].r);
  const lastT = T(path[path.length - 1].q, path[path.length - 1].r);
  // Orient upstream-first: reverse if the tail is the mountain end or the head
  // is the water end. A plain mid-land segment keeps the drawn order.
  if (lastT === "Mountains" || WATER.has(firstT)) path = path.reverse();
  const head = path[0];
  const tail = path[path.length - 1];
  const upstreamOpen = T(head.q, head.r) !== "Mountains";
  const downstreamOpen = !WATER.has(T(tail.q, tail.r));
  return { id, manual: true, source: { q: head.q, r: head.r }, path, upstreamOpen, downstreamOpen, reachedWater: !downstreamOpen };
}
