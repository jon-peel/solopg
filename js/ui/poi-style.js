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
  cave: "🕳️",
};

export const SETTLEMENT_GLYPH = "🏠";

export function glyphForPoiType(type) {
  return POI_GLYPHS[type] || "❖";
}
