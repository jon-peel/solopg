// Travel cost model (Phase 8.2, pure/node-only).
//
// Pace = hexes/day a party can cover on foot, per terrain. Day-by-day movement
// (8.4/8.5) sums `daysToCross` over a route to figure out how long a leg takes;
// getting lost (8.3) and the stepping algorithm itself are separate, later
// pieces that build on top of this table.

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
