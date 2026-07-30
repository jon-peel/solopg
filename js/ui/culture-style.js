// Culture rendering helpers (Phase 14.5) — the small PURE bits of the culture
// layer's presentation, split out from the imperative canvas code in map.js so
// they can be unit-tested. No DOM here: strength -> wash opacity, strength ->
// heartland/frontier band, and the contested-edge predicate. The colours + race
// labels themselves live in culture-data.js; the living field lives in culture.js.

import { LIVING_CFG } from "../gen/culture.js";

// A cultured hex (race != null) has strength in [THRESHOLD, 1]. The wash ramps
// its opacity across that band, but never below WASH_MIN — the earlier prototype's
// pure strength·k wash washed out to nothing under the terrain art at the fringe,
// so we floor it so a frontier hex still reads as "someone lives here", while a
// heartland hex is clearly bolder. Capped below opaque so terrain/POI icons show.
export const WASH_MIN_ALPHA = 0.22; // at the membership threshold (frontier)
export const WASH_MAX_ALPHA = 0.52; // at full strength (deep heartland)

// Strength at/above which a hex reads as a culture's HEARTLAND (vs its frontier).
export const HEARTLAND_STRENGTH = 0.6;

/**
 * Map a living-field strength to a culture-wash opacity. Sub-threshold / zero
 * strength (Human) washes to 0 (no tint). Within the membership band the opacity
 * ramps linearly from WASH_MIN_ALPHA (at THRESHOLD) to WASH_MAX_ALPHA (at 1).
 * @param {number} strength living-field strength at the hex
 * @returns {number} alpha in [0, WASH_MAX_ALPHA]
 */
export function washOpacity(strength) {
  const cut = LIVING_CFG.THRESHOLD;
  if (!(strength >= cut)) return 0; // Human / never-reached -> no wash
  const span = 1 - cut || 1;
  const t = Math.max(0, Math.min(1, (strength - cut) / span));
  return WASH_MIN_ALPHA + (WASH_MAX_ALPHA - WASH_MIN_ALPHA) * t;
}

/**
 * Heartland vs frontier band for a cultured hex, from its living-field strength.
 * @param {number} strength
 * @returns {"heartland"|"frontier"}
 */
export function cultureBand(strength) {
  return strength >= HEARTLAND_STRENGTH ? "heartland" : "frontier";
}

/**
 * True when the edge between two hexes is CONTESTED: both belong to a culture and
 * the cultures differ. Human (null) on either side is never contested — Human is
 * the null case, not a rival people (§5 rule 4).
 * @param {?string} a race on one side (null = Human)
 * @param {?string} b race on the other side
 * @returns {boolean}
 */
export function contestedEdge(a, b) {
  return !!a && !!b && a !== b;
}
