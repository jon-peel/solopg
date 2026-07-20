// Terrain → display style. The colour constants now live in theme.js (the
// single palette source shared by CSS + canvas); this module re-exports them so
// existing importers are unchanged, and owns the emoji motifs + lookup helpers.
import { TERRAIN_COLORS, UNKNOWN_COLOR, SELECTED_STROKE } from "./theme.js";
export { TERRAIN_COLORS, UNKNOWN_COLOR, SELECTED_STROKE };

// 2–3 emoji variants per terrain, drawn over the color fill. Variant is chosen
// deterministically per hex (see map.js) so it's stable without a schema change.
export const TERRAIN_ICONS = {
  Forest: ["🌲", "🌳"],
  Plains: ["🌾", "🌱"],
  Hills: ["⛰️", "🪨"],
  Mountains: ["🏔️", "🗻"],
  Swamp: ["🐊", "🌿"],
  Desert: ["🏜️", "🌵"],
  Lake: ["💧", "🏞️"],
  Sea: ["🌊", "🐚"],
};

export function colorForTerrain(terrain) {
  return TERRAIN_COLORS[terrain] || UNKNOWN_COLOR;
}

/** Emoji for a terrain, by variant index (wraps if out of range). */
export function iconForTerrain(terrain, variantIndex = 0) {
  const variants = TERRAIN_ICONS[terrain];
  if (!variants || variants.length === 0) return "";
  return variants[variantIndex % variants.length];
}
