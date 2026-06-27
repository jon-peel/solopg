// POI / settlement glyphs (shared by the map renderer and the panel).

export const POI_GLYPHS = {
  dungeon: "🏰", // default; a dungeon's actual glyph comes from its theme
  shrine: "⛩️",
  camp: "⛺",
  landmark: "🗿",
  tower: "🗼",
};

// Retired POI types, kept renderable so older saves still show a sensible glyph.
// `lair` was folded into dungeon den themes (Phase 5.1) and is no longer addable;
// the paw print lives on as the "Beast den" theme glyph in THEME_GLYPHS.
const LEGACY_POI_GLYPHS = { lair: "🐾" };

// Dungeon glyphs by theme (the merged ruin/cave/mine explorables live here).
// Theme names match data/dungeon-theme.json. Unknown themes fall back to 🏰.
export const THEME_GLYPHS = {
  Ruin: "🏚️",
  "Abandoned mine": "⛏️",
  "Cave complex": "🕳️",
  "Forgotten tomb": "🪦",
  Mausoleum: "🪦",
  "Cult shrine": "⛩️",
  "Flooded cistern": "🌊",
  "Goblin warren": "🏰",
  "Ruined fort": "🏰",
  "Wizard's sanctum": "🔮",
  "Beast den": "🐾",
  "Prison vaults": "🔒",
  "Smugglers' tunnels": "🕳️",
  "Kobold tunnels": "🐲",
  "Spider nest": "🕸️",
  "Ghoul warren": "💀",
  "Troglodyte caves": "🦎",
  "Ogre lair": "👹",
};

export const SETTLEMENT_GLYPH = "🏠";

export function glyphForPoiType(type) {
  return POI_GLYPHS[type] || LEGACY_POI_GLYPHS[type] || "❖";
}

/** Glyph for a dungeon theme (falls back to the generic dungeon glyph). */
export function glyphForDungeon(theme) {
  return THEME_GLYPHS[theme] || POI_GLYPHS.dungeon;
}

/**
 * Glyph for a POI object — theme-specific for dungeons, type-based otherwise.
 * @param {{ type: string, detail?: { theme?: string } }} poi
 */
export function glyphForPoi(poi) {
  if (poi && poi.type === "dungeon") {
    return glyphForDungeon(poi.detail && poi.detail.theme);
  }
  return glyphForPoiType(poi ? poi.type : undefined);
}
