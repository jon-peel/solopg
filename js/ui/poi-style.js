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

// Zoomed-out map dot colour by POI type (Phase 7.9). Falls back to the
// original all-POI red for unknown/legacy types.
export const POI_DOT_COLORS = {
  dungeon: "#d23b3b",
  shrine: "#9b6fd6",
  camp: "#e08a3c",
  landmark: "#4fa3a3",
  tower: "#8a5a3c",
};

// Per-faction map colour (Phase 8.7; re-tuned 11.4) — cycled by faction order so
// each power reads as one across all its holdings. A colour-blind-tolerant set
// that stays clear of the RED family (reserved for the selection ring + hook
// marks) and the party marker (magenta #ff4fd8), so the map layers stay legible
// on parchment. The per-faction HATCH angle (below) is the real differentiator —
// two neighbouring territories never rely on hue alone.
export const FACTION_COLORS = [
  "#2a6693", // blue
  "#b3641c", // burnt orange
  "#268572", // bluish-green
  "#7c53a0", // violet
  "#9c8020", // ochre
  "#7d5236", // brown
];

// Hatch-line angles (degrees), a coprime-length list so (colour, hatch) pairs
// stay distinct well past the point either list alone would repeat.
export const FACTION_HATCH_DEG = [0, 90, 45, 135, 22.5];

/** Map colour for the Nth faction (cycles the palette; safe for negatives). */
export function factionColor(index) {
  const n = FACTION_COLORS.length;
  return FACTION_COLORS[((index % n) + n) % n];
}

/** Hatch angle (deg) for the Nth faction — the colour-blind-safe differentiator. */
export function factionHatchDeg(index) {
  const n = FACTION_HATCH_DEG.length;
  return FACTION_HATCH_DEG[((index % n) + n) % n];
}

export function glyphForPoiType(type) {
  return POI_GLYPHS[type] || LEGACY_POI_GLYPHS[type] || "❖";
}

/** Far-zoom dot colour for a POI type (falls back to the default red). */
export function poiDotColor(type) {
  return POI_DOT_COLORS[type] || POI_DOT_COLORS.dungeon;
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
