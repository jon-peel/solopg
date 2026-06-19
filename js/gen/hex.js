// Single-hex generator (Phase 1).
//
// Pure: takes a preloaded Map of tables and an rng stream, returns a Hex object.
// No DOM, no fetch, no persistence — so it's unit-testable under `node --test`.
// Conditional sequencing (settlement size only if a settlement exists; POI count
// only if POIs exist) lives here; the weighted picks live in JSON tables.

import { rollTable } from "../core/table.js";
import { makeResolver } from "../core/loader.js";
import { rollDice } from "../core/dice.js";

// Default extra weight added to a terrain entry per matching neighbor.
const DEFAULT_TERRAIN_BIAS = 2;

/**
 * Build a terrain table biased toward neighbor terrains. Returns a NEW table
 * (never mutates the base); each entry is spread so its `roll` (e.g. Swamp's
 * nested swamp-feature roll) is preserved. Each neighbor matching an entry's
 * value adds `bias` to that entry's weight.
 * @param {object} baseTable canonical terrain table
 * @param {string[]} neighborTerrains terrain strings of existing neighbors
 * @param {number} [bias]
 * @returns {object} new table
 */
export function weightedTerrainTable(
  baseTable,
  neighborTerrains = [],
  bias = DEFAULT_TERRAIN_BIAS,
) {
  const counts = new Map();
  for (const t of neighborTerrains) counts.set(t, (counts.get(t) || 0) + 1);
  const entries = baseTable.entries.map((e) => {
    const base = "weight" in e ? e.weight : 1;
    const bump = (counts.get(e.value) || 0) * bias;
    return { ...e, weight: base + bump };
  });
  return { id: baseTable.id, entries };
}

/**
 * Generate one hex from the given tables and random stream.
 * @param {Map<string, object>} tables must include terrain, settlement-presence,
 *   settlement-size, poi-presence (and any sub-tables terrain references).
 * @param {() => number} rng a single stream consumed in a fixed order
 * @param {{ key?: string, coords?: object|null, placed?: boolean,
 *   neighborTerrains?: string[], terrainBias?: number }} [opts]
 * @returns {object} hex
 */
export function generateHex(tables, rng, opts = {}) {
  const resolve = makeResolver(tables);

  // 1. Terrain (with any nested feature roll, e.g. Swamp -> swamp-feature).
  // Bias toward neighbor terrains when the caller supplies them.
  const baseTerrain = tables.get("terrain");
  const terrainTable =
    opts.neighborTerrains && opts.neighborTerrains.length
      ? weightedTerrainTable(baseTerrain, opts.neighborTerrains, opts.terrainBias)
      : baseTerrain;
  const terrainRoll = rollTable(terrainTable, rng, { resolve });
  const terrain = terrainRoll.value;
  const terrainFeature = terrainRoll.sub ? terrainRoll.sub.value : null;

  // 2. Settlement present? -> 3. size (only if present).
  const settlementPresent = rollTable(tables.get("settlement-presence"), rng)
    .value.present;
  let settlement;
  if (settlementPresent) {
    const size = rollTable(tables.get("settlement-size"), rng).value.size;
    settlement = { present: true, size };
  } else {
    settlement = { present: false };
  }

  // 4. POIs present? -> count (only if present). `count` is dice notation.
  const poiEntry = rollTable(tables.get("poi-presence"), rng).value;
  let pois;
  if (poiEntry.present) {
    const count = rollDice(poiEntry.count, rng).total;
    pois = { present: true, count };
  } else {
    pois = { present: false, count: 0 };
  }

  return {
    key: opts.key ?? null,
    coords: opts.coords ?? null,
    placed: opts.placed ?? false,
    terrain,
    terrainFeature,
    settlement,
    // Phase 1 stores a POI count only; Phase 3 expands each POI into a detailed
    // object (type, occupant, etc.).
    pois,
    explored: true,
    createdAt: new Date().toISOString(),
  };
}
