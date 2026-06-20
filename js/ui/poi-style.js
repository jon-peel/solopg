// POI / settlement glyphs (shared by the map renderer and the panel).

export const POI_GLYPHS = {
  dungeon: "🏰",
  lair: "🐾",
  ruin: "🏚️",
  shrine: "⛩️",
  camp: "⛺",
  landmark: "🗿",
  tower: "🗼",
  mine: "⛏️",
};

export const POI_BADGE = "❖"; // generic marker when a hex has multiple POIs
export const SETTLEMENT_GLYPH = "🏠";

export function glyphForPoiType(type) {
  return POI_GLYPHS[type] || POI_BADGE;
}
