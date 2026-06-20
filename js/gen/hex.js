// Single-hex generator (Phase 1).
//
// Pure: takes a preloaded Map of tables and an rng stream, returns a Hex object.
// No DOM, no fetch, no persistence — so it's unit-testable under `node --test`.
// Conditional sequencing (settlement size only if a settlement exists; POI count
// only if POIs exist) lives here; the weighted picks live in JSON tables.

import { rollTable } from "../core/table.js";
import { makeResolver } from "../core/loader.js";
import { rollDice } from "../core/dice.js";
import { subRng } from "../core/rng.js";
import { TERRAIN_AFFINITY } from "./terrain-affinity.js";
import { profileFor, cappedSizeTable } from "./terrain-profile.js";
import { generatePoi } from "./poi.js";

/**
 * Build a terrain table biased toward neighbor terrains using an affinity
 * matrix (compatible terrains get a bonus, not just identical ones). Returns a
 * NEW table (never mutates the base); each entry is spread so its `roll` (e.g.
 * Swamp's nested swamp-feature roll) is preserved.
 * @param {object} baseTable canonical terrain table
 * @param {string[]} neighborTerrains terrain strings of existing neighbors
 * @param {{ affinity?: object, multiplier?: number }} [opts]
 * @returns {object} new table
 */
export function weightedTerrainTable(baseTable, neighborTerrains = [], opts = {}) {
  const affinity = opts.affinity || TERRAIN_AFFINITY;
  const multiplier = opts.multiplier ?? 1;
  const entries = baseTable.entries.map((e) => {
    const base = "weight" in e ? e.weight : 1;
    let bonus = 0;
    for (const nbr of neighborTerrains) {
      bonus += (affinity[nbr] && affinity[nbr][e.value]) || 0;
    }
    return { ...e, weight: base + bonus * multiplier };
  });
  return { id: baseTable.id, entries };
}

/**
 * Generate one hex from the given tables and random stream.
 * @param {Map<string, object>} tables must include terrain, settlement-size,
 *   poi-types, poi-occupant, creatures, occupiers (and terrain sub-tables).
 * @param {() => number} rng a single stream consumed in a fixed order
 * @param {{ key?: string, coords?: object|null, placed?: boolean,
 *   neighborTerrains?: string[], terrainBias?: number,
 *   seed?: number|string, gen?: number }} [opts]
 *   seed+gen+coords seed per-POI sub-streams (order-stable).
 * @returns {object} hex
 */
export function generateHex(tables, rng, opts = {}) {
  const resolve = makeResolver(tables);

  // 1. Terrain. Either forced (manual placement) or rolled — when rolled, bias
  //    toward neighbor terrains and resolve any nested feature (Swamp).
  let terrain;
  let terrainFeature = null;
  if (opts.terrain) {
    terrain = opts.terrain;
  } else {
    const baseTerrain = tables.get("terrain");
    const terrainTable =
      opts.neighborTerrains && opts.neighborTerrains.length
        ? weightedTerrainTable(baseTerrain, opts.neighborTerrains, {
            multiplier: opts.terrainBias,
          })
        : baseTerrain;
    const terrainRoll = rollTable(terrainTable, rng, { resolve });
    terrain = terrainRoll.value;
    terrainFeature = terrainRoll.sub ? terrainRoll.sub.value : null;
  }

  // Subsequent rolls (settlement, POIs) are gated by the chosen terrain's
  // profile — so a manually-placed Water hex still gets no settlement, etc.
  const profile = profileFor(terrain);

  // 2. Settlement: presence + size are gated by the terrain profile (e.g. no
  //    settlement on Water; size capped — no City in Desert).
  let settlement = { present: false };
  if (profile.settlement) {
    const present = rng() < profile.settlement.chance;
    if (present) {
      const sizeTable = cappedSizeTable(
        tables.get("settlement-size"),
        profile.settlement.maxSize,
      );
      if (sizeTable) {
        settlement = { present: true, size: rollTable(sizeTable, rng).value.size };
      }
    }
  }

  // 3. POIs: presence/count from the profile; each POI is a typed object built
  //    from its own deterministic sub-stream (order-stable).
  const pois = [];
  if (rng() < profile.poi.chance) {
    const n = rollDice(profile.poi.count, rng).total;
    const base = opts.coords
      ? ["hex", opts.coords.q, opts.coords.r, opts.gen ?? 0]
      : ["hex", opts.key ?? "?", opts.gen ?? 0];
    for (let i = 0; i < n; i++) {
      const poiRng = subRng(opts.seed ?? 0, ...base, "poi", i);
      pois.push(generatePoi(tables, poiRng, { terrain, index: i }));
    }
  }

  return {
    key: opts.key ?? null,
    coords: opts.coords ?? null,
    placed: opts.placed ?? false,
    terrain,
    terrainFeature,
    settlement,
    pois, // typed POI[] (Phase 3); empty array when none
    explored: true,
    createdAt: new Date().toISOString(),
  };
}
