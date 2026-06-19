// Terrain → display color. Single source for both the map renderer and the
// terrain dropdown (so the two can't drift).

export const TERRAIN_COLORS = {
  Forest: "#2f6b3a",
  Plains: "#9bbd5a",
  Hills: "#b08d4f",
  Mountains: "#7d7f88",
  Swamp: "#4b5f49",
};

export const UNKNOWN_COLOR = "#3a3f4b";
export const SELECTED_STROKE = "#ffd166";

export function colorForTerrain(terrain) {
  return TERRAIN_COLORS[terrain] || UNKNOWN_COLOR;
}
