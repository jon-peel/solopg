// Per-terrain generation rules (pure data + helpers).
//
// Mirrors terrain-affinity.js: rules/structure live in a JS const (no fetch),
// while flavor content (POI types, creatures, occupiers) lives in JSON tables.
// This gates settlement presence + max size and which POI types a terrain allows
// (the keys of `poi.weights` are the ONLY types that terrain can produce).

import { TERRAIN_COLORS } from "../ui/terrain-style.js";

// Ascending settlement sizes; used to cap by terrain.
export const SIZE_ORDER = ["Thorp", "Hamlet", "Village", "Town", "City"];

export const TERRAIN_PROFILE = {
  Forest: {
    settlement: { chance: 0.3, maxSize: "City" },
    poi: { chance: 0.55, weights: { lair: 4, ruin: 3, shrine: 2, camp: 2, dungeon: 2, cave: 2, landmark: 1, tower: 1 } },
  },
  Plains: {
    settlement: { chance: 0.45, maxSize: "City" },
    poi: { chance: 0.4, weights: { ruin: 3, shrine: 2, camp: 3, landmark: 2, lair: 1, tower: 1 } },
  },
  Hills: {
    settlement: { chance: 0.35, maxSize: "Town" },
    poi: { chance: 0.55, weights: { mine: 4, cave: 3, lair: 3, ruin: 2, dungeon: 2, tower: 2, shrine: 1 } },
  },
  Mountains: {
    settlement: { chance: 0.15, maxSize: "Hamlet" },
    poi: { chance: 0.6, weights: { mine: 4, cave: 4, dungeon: 3, lair: 3, tower: 2, ruin: 2, shrine: 1 } },
  },
  Swamp: {
    settlement: { chance: 0.15, maxSize: "Hamlet" },
    poi: { chance: 0.55, weights: { lair: 4, ruin: 3, cave: 2, shrine: 2, dungeon: 2, landmark: 1 } },
  },
  Desert: {
    settlement: { chance: 0.2, maxSize: "Town" },
    poi: { chance: 0.45, weights: { ruin: 4, shrine: 3, cave: 2, lair: 2, landmark: 2, tower: 1, mine: 1 } },
  },
  Water: {
    settlement: null, // no settlements on open water
    poi: { chance: 0.2, weights: { ruin: 2, landmark: 2, shrine: 1, lair: 1 } },
  },
};

const DEFAULT_PROFILE = {
  settlement: { chance: 0.25, maxSize: "City" },
  poi: { chance: 0.4, weights: { ruin: 2, landmark: 1 } },
};

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

// Re-export for parity tests (every styled terrain should have a profile).
export const KNOWN_TERRAINS = Object.keys(TERRAIN_COLORS);
