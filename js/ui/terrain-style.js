// Terrain → display style. Single source for the map renderer and the terrain
// place buttons (so the two can't drift).

export const TERRAIN_COLORS = {
  Forest: "#2f6b3a",
  Plains: "#9bbd5a",
  Hills: "#b08d4f",
  Mountains: "#7d7f88",
  Swamp: "#4b5f49",
  Desert: "#d9c27a",
  Lake: "#4a8fc2", // lighter/more turquoise — inland fresh water (Phase 3R.4)
  Sea: "#2c5a8c", // deeper blue — coastal/oceanic salt water (Phase 3R.4)
};

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

export const UNKNOWN_COLOR = "#3a3f4b";
export const SELECTED_STROKE = "#ffd166";

export function colorForTerrain(terrain) {
  return TERRAIN_COLORS[terrain] || UNKNOWN_COLOR;
}

/** Emoji for a terrain, by variant index (wraps if out of range). */
export function iconForTerrain(terrain, variantIndex = 0) {
  const variants = TERRAIN_ICONS[terrain];
  if (!variants || variants.length === 0) return "";
  return variants[variantIndex % variants.length];
}
