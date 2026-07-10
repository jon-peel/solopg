// Travel cost model (Phase 8.2, pure/node-only).
//
// Pace = hexes/day a party can cover on foot, per terrain. Day-by-day movement
// (8.4/8.5) sums `daysToCross` over a route to figure out how long a leg takes;
// getting lost (8.3, below) and the stepping algorithm itself (8.4/8.5) are
// separate pieces that build on top of this table.

import { subRng } from "../core/rng.js";

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
