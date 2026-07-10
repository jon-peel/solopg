// Travel cost model (Phase 8.2, pure/node-only).
//
// Pace = hexes/day a party can cover on foot, per terrain. Day-by-day movement
// (8.4/8.5) sums `daysToCross` over a route to figure out how long a leg takes;
// getting lost (8.3, below) and the stepping algorithm itself (8.4/8.5) are
// separate pieces that build on top of this table.

import { subRng } from "../core/rng.js";
import { neighbors, axialKey, parseKey, axialDistance, NEIGHBOR_DIRS } from "../core/hexgeo.js";
import { MinHeap } from "../core/minheap.js";

// Hexes/day, off-road, on foot — illustrative starting point (flagged for
// real-play retuning, same as every other generation constant in this
// project; see docs/plans/phase-8-factions.md). Lake/Sea are impassable on
// foot — naval travel is out of scope for Phase 8.
export const TRAVEL_COST = {
  Plains: 4,
  Forest: 2,
  Hills: 2,
  Desert: 2,
  Swamp: 1,
  Mountains: 1,
  Lake: 0,
  Sea: 0,
};

// A road/track discount: pace ×2. Flat (no highway-vs-track split — not
// specified by the plan, so not invented here).
export const ROAD_PACE_MULTIPLIER = 2;

// Encumbrance tiers (B/X-style) — the same 4 tiers the app's existing
// travel-tip tooltip already shows (hover the scale bar): Unencumbered/Lightly
// loaded/Encumbered/Heavily loaded = the classic 24/18/12/6 mi-per-day ladder,
// i.e. 1 / ¾ / ½ / ¼ of full speed. A party's tier lives at
// `world.party.encumbrance`; absent means "unencumbered" (today's numbers,
// unchanged) — additive, no schema bump needed (mirrors the `hex.locked` /
// `settlement.kind` "absent = default state" convention).
export const ENCUMBRANCE_FACTOR = {
  unencumbered: 1,
  light: 0.75,
  encumbered: 0.5,
  heavy: 0.25,
};

/**
 * Pace in hexes/day for crossing one hex of `terrain`, on foot.
 * @param {string} terrain
 * @param {{road?: boolean, encumbrance?: string}} [opts]
 *   road: this hex is being crossed via a road/track
 *   encumbrance: one of ENCUMBRANCE_FACTOR's keys; defaults to "unencumbered"
 * @returns {number} hexes/day; 0 if impassable off-road (Lake/Sea, or an
 *   unknown terrain key) — a `road` flag never overrides impassability, since
 *   roads never cross water anyway.
 */
export function paceFor(terrain, { road = false, encumbrance = "unencumbered" } = {}) {
  const base = TRAVEL_COST[terrain] ?? 0;
  if (base <= 0) return 0;
  const factor = ENCUMBRANCE_FACTOR[encumbrance] ?? ENCUMBRANCE_FACTOR.unencumbered;
  return (road ? base * ROAD_PACE_MULTIPLIER : base) * factor;
}

/**
 * Days to cross one hex of `terrain` — the reciprocal of pace.
 * @param {string} terrain
 * @param {{road?: boolean, encumbrance?: string}} [opts]
 * @returns {number} days (fractional); Infinity if impassable (pace 0)
 */
export function daysToCross(terrain, opts) {
  return 1 / paceFor(terrain, opts);
}

// --- Getting lost (Phase 8.3) ---------------------------------------------

// Per-day, off-road chance of drifting off course — d6-flavoured to match the
// existing B/X travel-tip tooltip's style. Illustrative starting point (same
// retuning caveat as TRAVEL_COST). Lake/Sea are 0 for table completeness —
// moot in practice, since pace there is already 0/impassable.
export const LOST_CHANCE = {
  Plains: 1 / 6,
  Forest: 2 / 6,
  Hills: 2 / 6,
  Desert: 2 / 6,
  Swamp: 3 / 6,
  Mountains: 3 / 6,
  Lake: 0,
  Sea: 0,
};

/**
 * Roll whether a day of off-road travel through `terrain` goes astray.
 * Deterministic per (day, q, r) — the same day at the same position always
 * rolls the same, regardless of when it's actually simulated.
 * @param {number|string} seed world seed
 * @param {number} day the day being resolved
 * @param {number} q current position
 * @param {number} r
 * @param {string} terrain terrain of the hex being crossed that day
 * @param {{road?: boolean}} [opts] road: always false, roads are never lost
 * @returns {boolean}
 */
export function rollGetLost(seed, day, q, r, terrain, { road = false } = {}) {
  if (road) return false;
  const chance = LOST_CHANCE[terrain] ?? 0;
  if (chance <= 0) return false;
  const rng = subRng(seed, "travel", day, q, r);
  return rng() < chance;
}

/**
 * Pick the direction actually travelled on a day the party got lost: one of
 * the two hex-directions adjacent to `intendedDir` in NEIGHBOR_DIRS' fixed
 * cyclic order (never the intended direction itself, never the opposite one).
 * A deterministic coin flip picks a side; if that neighbour is impassable
 * (per the injected `isPassable` predicate — kept as a callback rather than a
 * terrain lookup so this module stays pure, and so the caller can answer for
 * not-yet-generated frontier hexes), it swaps to the other side. If BOTH
 * adjacent hexes are impassable, falls back to holding `intendedDir` (an edge
 * case the plan doesn't specify — simplest safe default).
 * @param {number|string} seed world seed
 * @param {number} day
 * @param {number} q current position
 * @param {number} r
 * @param {number} intendedDir index (0-5) into NEIGHBOR_DIRS, the bearing being followed
 * @param {(dir: number) => boolean} [isPassable] predicate over a candidate direction; defaults to always-passable
 * @returns {number} the direction (0-5) actually travelled
 */
export function deviateDirection(seed, day, q, r, intendedDir, isPassable = () => true) {
  const left = (intendedDir + 5) % 6;
  const right = (intendedDir + 1) % 6;
  const rng = subRng(seed, "travel-deviate", day, q, r);
  const [first, second] = rng() < 0.5 ? [left, right] : [right, left];
  if (isPassable(first)) return first;
  if (isPassable(second)) return second;
  return intendedDir;
}

// --- Route-finding + day-by-day movement (Phase 8.4) ----------------------

// Cheapest possible per-hex day-cost (fastest terrain, on a road, unencumbered)
// — an admissible A* heuristic unit, same role as roads.js's H_UNIT.
const H_UNIT = 1 / (Math.max(...Object.values(TRAVEL_COST)) * ROAD_PACE_MULTIPLIER);

/**
 * The set of "q,r" keys any road passes through — the road pace bonus, built
 * on demand from `world.roads[]` (the equivalent Set roads.js builds
 * internally for its own routing, but doesn't export).
 * @param {{path:{q:number,r:number}[]}[]} roads
 * @returns {Set<string>}
 */
export function roadHexKeySet(roads) {
  const keys = new Set();
  for (const road of roads || []) {
    for (const p of road.path || []) keys.add(axialKey(p.q, p.r));
  }
  return keys;
}

/**
 * Least-cost route (by DAYS, not distance) from (aq,ar) to (bq,br) over
 * PLACED hexes only — `terrainByKey` (a Map of "q,r" -> terrain string) has an
 * entry for every placed hex; any other coordinate is impassable, so a route
 * can never cross an unplaced gap (that's 8.5's lazy-generation territory,
 * not this one's). Mirrors roads.js's `routeBetween` shape (A* via the shared
 * `MinHeap`), but costed by `daysToCross` (the travel-pace model) instead of
 * road-building cost — a road hex is naturally preferred (half the days), no
 * separate "prefer roads" phase needed. Encumbrance is deliberately left out:
 * a flat multiplier over every hex can never change which path has the
 * lowest TOTAL cost, so it only matters once the day-by-day simulation
 * converts the chosen route into actual elapsed time.
 * @param {number} aq
 * @param {number} ar
 * @param {number} bq
 * @param {number} br
 * @param {Map<string,string>} terrainByKey
 * @param {Set<string>} roadHexKeys
 * @returns {{path:{q:number,r:number}[], days:number}|null} path is a-first
 *   inclusive; null if unreachable (goal/start unplaced, or no connected
 *   placed-hex route between them)
 */
export function planRoute(aq, ar, bq, br, terrainByKey, roadHexKeys) {
  const startK = axialKey(aq, ar), goalK = axialKey(bq, br);
  if (terrainByKey.get(startK) === undefined || terrainByKey.get(goalK) === undefined) return null;
  if (startK === goalK) return { path: [{ q: aq, r: ar }], days: 0 };
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
      const terrain = terrainByKey.get(nk);
      if (terrain === undefined) continue; // unplaced — impassable for this route
      const step = daysToCross(terrain, { road: roadHexKeys.has(nk) });
      if (!isFinite(step)) continue;
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
  return { path, days: g.get(goalK) };
}

// Direction index (0-5 into NEIGHBOR_DIRS) from one hex to an ADJACENT one.
function directionBetween(aq, ar, bq, br) {
  const dq = bq - aq, dr = br - ar;
  return NEIGHBOR_DIRS.findIndex(([ddq, ddr]) => ddq === dq && ddr === dr);
}

const MAX_TRIP_STEPS = 300; // defensive backstop; no realistic trip gets close

/**
 * Resolve a full trip toward (bq,br) from (aq,ar), day by day, over PLACED
 * hexes only (see `planRoute`).
 *
 * Each hex crossed: re-plans the route only on the first step or right after
 * a deviation (not wastefully every day when nothing went wrong); charges the
 * cost of ENTERING that hex (`daysToCross`, matching roads.js's own "cost to
 * enter" convention); rolls `rollGetLost` ONCE per hex crossed (not per
 * calendar day — risk scales with distance, elapsed time scales separately
 * via the day cost, avoiding the perverse case where fast travel would need
 * FEWER rolls than slow travel over the same distance); on a lost roll, steps
 * into `deviateDirection`'s pick instead of the intended hex (logged as "on
 * course" rather than "lost" if both adjacent hexes were blocked and it held
 * the intended direction anyway — nothing actually changed).
 * @param {number|string} seed world seed
 * @param {number} startDay the world's current day count when the trip begins
 * @param {number} aq start q
 * @param {number} ar start r
 * @param {number} bq target q
 * @param {number} br target r
 * @param {Map<string,string>} terrainByKey
 * @param {Set<string>} roadHexKeys
 * @param {{encumbrance?: string}} [opts]
 * @returns {{
 *   finalPos: {q:number,r:number}, days: number, arrived: boolean,
 *   reason?: "stranded"|"too-long",
 *   log: {day:number, q:number, r:number, terrain:string, road:boolean, lost:boolean, note:string}[]
 * }}
 */
export function planMoveToward(seed, startDay, aq, ar, bq, br, terrainByKey, roadHexKeys, { encumbrance = "unencumbered" } = {}) {
  let cur = { q: aq, r: ar };
  const target = { q: bq, r: br };
  const log = [];
  let daysElapsed = 0;
  let plannedPath = null; // {q,r}[] from the last planRoute call, cur-first

  if (cur.q === target.q && cur.r === target.r) {
    return { finalPos: cur, days: 0, arrived: true, log };
  }

  for (let step = 0; step < MAX_TRIP_STEPS; step++) {
    if (!plannedPath || plannedPath.length < 2) {
      const route = planRoute(cur.q, cur.r, target.q, target.r, terrainByKey, roadHexKeys);
      if (!route) {
        return { finalPos: cur, days: Math.ceil(daysElapsed), arrived: false, reason: "stranded", log };
      }
      plannedPath = route.path;
    }
    const intended = plannedPath[1];
    const intendedDir = directionBetween(cur.q, cur.r, intended.q, intended.r);
    const day = startDay + step;
    const isPassable = (dir) => {
      const [ddq, ddr] = NEIGHBOR_DIRS[dir];
      const t = terrainByKey.get(axialKey(cur.q + ddq, cur.r + ddr));
      return t !== undefined && paceFor(t) > 0;
    };
    // Terrain/road context for the ENTERED hex drives both the day cost and
    // the lost roll (cost is charged entering a hex — roads.js's convention).
    const intendedTerrain = terrainByKey.get(axialKey(intended.q, intended.r));
    const onRoad = roadHexKeys.has(axialKey(intended.q, intended.r));
    const gotLost = rollGetLost(seed, day, cur.q, cur.r, intendedTerrain, { road: onRoad });
    const actualDir = gotLost ? deviateDirection(seed, day, cur.q, cur.r, intendedDir, isPassable) : intendedDir;
    const reallyDeviated = actualDir !== intendedDir;
    const [ddq, ddr] = NEIGHBOR_DIRS[actualDir];
    const next = { q: cur.q + ddq, r: cur.r + ddr };
    const nextTerrain = terrainByKey.get(axialKey(next.q, next.r));
    const nextOnRoad = roadHexKeys.has(axialKey(next.q, next.r));
    const dayCost = daysToCross(nextTerrain, { road: nextOnRoad, encumbrance });

    daysElapsed += dayCost;
    log.push({
      day, q: next.q, r: next.r, terrain: nextTerrain, road: nextOnRoad, lost: reallyDeviated,
      note: reallyDeviated ? "got turned around, drifted off course" : "on course",
    });
    cur = next;

    if (cur.q === target.q && cur.r === target.r) {
      return { finalPos: cur, days: Math.ceil(daysElapsed), arrived: true, log };
    }
    plannedPath = reallyDeviated ? null : plannedPath.slice(1);
  }
  return { finalPos: cur, days: Math.ceil(daysElapsed), arrived: false, reason: "too-long", log };
}
