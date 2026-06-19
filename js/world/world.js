// Core domain model.
//
// Phase 0 only needs a valid, empty, named world. Hex / Settlement / POI /
// Dungeon / Faction structures arrive in later phases; `hexes` is the keyed
// collection they will populate.

export const SCHEMA_VERSION = 1;

// Default hex scale in miles (classic 6-mile hex). Configurable per world.
const DEFAULT_HEX_SCALE = 6;

/**
 * Create a new, empty world.
 * @param {{ name?: string, seed?: number|string }} [opts]
 * @returns {object} world
 */
export function createWorld({ name = "Untitled World", seed } = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    // The seed makes generation reproducible/shareable; if none is supplied we
    // mint a random one and persist it as the world's canonical seed.
    seed: seed ?? randomSeed(),
    hexScale: DEFAULT_HEX_SCALE,
    hexes: {},
    createdAt: now,
    updatedAt: now,
  };
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. older test runtimes).
  return "w-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function randomSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
