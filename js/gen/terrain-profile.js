// Per-terrain generation rules (pure data + helpers).
//
// Mirrors terrain-affinity.js: rules/structure live in a JS const (no fetch),
// while flavor content (themes, creatures, occupiers) lives in JSON tables.
// This gates settlement presence + max size, which POI types a terrain allows
// (the keys of `poi.weights` are the ONLY types that terrain can produce), and
// which dungeon themes a terrain leans toward (DUNGEON_THEME_BIAS). The
// explorable POI types (ruin/cave/mine) were merged into `dungeon` as themes.

import { TERRAIN_COLORS } from "../ui/terrain-style.js";

// Ascending settlement sizes; used to cap by terrain.
export const SIZE_ORDER = ["Thorp", "Hamlet", "Village", "Town", "City"];

export const TERRAIN_PROFILE = {
  Forest: {
    settlement: { chance: 0.3, maxSize: "City" },
    poi: { chance: 0.55, weights: { dungeon: 4, lair: 4, shrine: 2, camp: 2, landmark: 1, tower: 1 } },
  },
  Plains: {
    settlement: { chance: 0.45, maxSize: "City" },
    poi: { chance: 0.4, weights: { dungeon: 3, camp: 3, shrine: 2, landmark: 2, lair: 1, tower: 1 } },
  },
  Hills: {
    settlement: { chance: 0.35, maxSize: "Town" },
    poi: { chance: 0.55, weights: { dungeon: 5, lair: 3, tower: 2, shrine: 1 } },
  },
  Mountains: {
    settlement: { chance: 0.15, maxSize: "Hamlet" },
    poi: { chance: 0.6, weights: { dungeon: 6, lair: 3, tower: 2, shrine: 1 } },
  },
  Swamp: {
    settlement: { chance: 0.15, maxSize: "Hamlet" },
    poi: { chance: 0.55, weights: { dungeon: 4, lair: 4, shrine: 2, landmark: 1 } },
  },
  Desert: {
    settlement: { chance: 0.2, maxSize: "Town" },
    poi: { chance: 0.45, weights: { dungeon: 5, shrine: 3, lair: 2, landmark: 2, tower: 1 } },
  },
  Water: {
    settlement: null, // no settlements on open water
    poi: { chance: 0.2, weights: { landmark: 2, shrine: 1, lair: 1 } }, // no dungeon on open water
  },
};

const DEFAULT_PROFILE = {
  settlement: { chance: 0.25, maxSize: "City" },
  poi: { chance: 0.4, weights: { dungeon: 2, landmark: 1 } },
};

// Which dungeon themes a terrain leans toward. Theme names must exist in
// data/dungeon-theme.json (the canonical manifest). A terrain with no entry
// here falls back to DEFAULT_THEME_BIAS.
export const DUNGEON_THEME_BIAS = {
  Forest: { Ruin: 3, "Beast den": 2, "Cave complex": 1, "Forgotten tomb": 1, "Cult shrine": 1, "Goblin warren": 1, "Spider nest": 1, "Kobold tunnels": 1 },
  Plains: { Ruin: 3, "Ruined fort": 2, "Forgotten tomb": 1, "Cult shrine": 1, "Goblin warren": 1, "Kobold tunnels": 1 },
  Hills: { "Abandoned mine": 3, "Cave complex": 3, Ruin: 1, "Goblin warren": 1, "Ruined fort": 1, "Kobold tunnels": 2, "Troglodyte caves": 1, "Ogre lair": 1 },
  Mountains: { "Abandoned mine": 3, "Cave complex": 3, "Goblin warren": 2, "Wizard's sanctum": 1, "Prison vaults": 1, "Kobold tunnels": 2, "Troglodyte caves": 2, "Ogre lair": 1 },
  Swamp: { "Flooded cistern": 2, Ruin: 2, "Cult shrine": 2, "Beast den": 1, "Cave complex": 1, "Ghoul warren": 1, "Troglodyte caves": 1, "Spider nest": 1 },
  Desert: { "Forgotten tomb": 3, Mausoleum: 2, Ruin: 2, "Cult shrine": 1, "Cave complex": 1, "Ghoul warren": 1 },
  Water: { "Flooded cistern": 2, Ruin: 1 }, // only reachable via a manual (forced) dungeon on water
};

// Spread used when a terrain has no specific bias.
const DEFAULT_THEME_BIAS = { Ruin: 3, "Cave complex": 2, "Forgotten tomb": 2, "Ruined fort": 1, "Beast den": 1 };

/** Profile for a terrain (safe default for unknown terrain). */
export function profileFor(terrain) {
  return TERRAIN_PROFILE[terrain] || DEFAULT_PROFILE;
}

/**
 * Return a NEW settlement-size table filtered to sizes <= maxSize (by SIZE_ORDER).
 * Never mutates the base. Returns null if no sizes qualify.
 * @param {object} sizeTable canonical settlement-size table (value.size)
 * @param {string} maxSize
 */
export function cappedSizeTable(sizeTable, maxSize) {
  const cap = SIZE_ORDER.indexOf(maxSize);
  const entries = sizeTable.entries.filter(
    (e) => SIZE_ORDER.indexOf(e.value.size) <= cap,
  );
  if (entries.length === 0) return null;
  return { id: sizeTable.id, entries };
}

/**
 * Build a weighted POI-type table for a terrain from its profile weights.
 * Entries: { weight, value: typeString }.
 */
export function poiTypeTable(terrain) {
  const weights = profileFor(terrain).poi.weights;
  const entries = Object.entries(weights).map(([type, weight]) => ({
    weight,
    value: type,
  }));
  return { id: `poi-types:${terrain}`, entries };
}

/**
 * Build a weighted dungeon-theme table for a terrain from DUNGEON_THEME_BIAS.
 * Entries: { weight, value: themeString }. Mirrors poiTypeTable.
 */
export function dungeonThemeTable(terrain) {
  const weights = DUNGEON_THEME_BIAS[terrain] || DEFAULT_THEME_BIAS;
  const entries = Object.entries(weights).map(([theme, weight]) => ({
    weight,
    value: theme,
  }));
  return { id: `dungeon-theme:${terrain}`, entries };
}

// Re-export for parity tests (every styled terrain should have a profile).
export const KNOWN_TERRAINS = Object.keys(TERRAIN_COLORS);

