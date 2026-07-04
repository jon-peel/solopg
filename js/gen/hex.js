// Single-hex generator (Phase 1).
//
// Pure: takes a preloaded Map of tables and an rng stream, returns a Hex object.
// No DOM, no fetch, no persistence — so it's unit-testable under `node --test`.
// Conditional sequencing (settlement size only if a settlement exists; POI count
// only if POIs exist) lives here; the weighted picks live in JSON tables.

import { rollTable } from "../core/table.js";
import { makeResolver } from "../core/loader.js";
import { subRng } from "../core/rng.js";
import { terrainAt } from "./affinity.js";
import { profileFor, cappedSizeTable, suppressLargeSizes } from "./terrain-profile.js";
import { generatePoi } from "./poi.js";

/**
 * Generate one hex from the given tables and random stream.
 * @param {Map<string, object>} tables must include terrain, settlement-size,
 *   poi-types, poi-occupant, creatures, occupiers (and terrain sub-tables).
 * @param {() => number} rng a single stream consumed in a fixed order
 * @param {{ key?: string, coords?: object|null, placed?: boolean,
 *   terrain?: string, seed?: number|string, gen?: number, neighborTerrains?: string[],
 *   nearbyLargeCount?: number }} [opts]
 *   seed+gen+coords seed per-POI sub-streams (order-stable). neighborTerrains
 *   are the terrains of this hex's already-placed neighbours — they bias the
 *   affinity terrain roll (js/gen/affinity.js); omit/[] for a hex revealed with
 *   no placed neighbours. nearbyLargeCount is how many large (Town/City)
 *   settlements already sit within a day's travel — it softly suppresses this
 *   hex rolling large too (js/gen/terrain-profile.js suppressLargeSizes), so big
 *   settlements rarely cluster; omit/0 when none are near.
 * @returns {object} hex
 */
export function generateHex(tables, rng, opts = {}) {
  const resolve = makeResolver(tables);

  // 1. Terrain: forced (manual placement) or the neighbour-affinity roll — a
  //    weighted dice roll biased by the terrains of already-revealed
  //    neighbours (js/gen/affinity.js). No elevation/moisture: the world is a
  //    hex oracle, each tile "anything until revealed", so terrain is
  //    order-dependent by design (see the affinity module comment).
  const coords = opts.coords || { q: 0, r: 0 };
  const classified = terrainAt(opts.seed ?? 0, coords.q, coords.r, opts.neighborTerrains ?? []);
  const terrain = opts.terrain || classified;

  // Nested terrain feature (e.g. Swamp's swamp-feature roll) stays
  // data-driven via data/terrain.json's entries[].roll — resolved directly
  // against the chosen terrain's entry, not via a re-roll of the top table.
  let terrainFeature = null;
  const terrainEntry = tables.get("terrain").entries.find((e) => e.value === terrain);
  if (terrainEntry && terrainEntry.roll) {
    const sub = rollTable(resolve(terrainEntry.roll.table), rng, { resolve });
    terrainFeature = sub.value;
  }

  // Subsequent rolls (settlement, POIs) are gated by the chosen terrain's
  // profile (Lake/Sea alias to Water's — see terrain-profile.js biasKey) —
  // so a manually-placed Lake/Sea hex still gets no settlement, etc.
  const profile = profileFor(terrain);

  // 2. Settlement: presence + size are gated by the terrain profile (e.g. no
  //    settlement on Water; size capped — no City in Desert).
  let settlement = { present: false };
  if (profile.settlement) {
    const present = rng() < profile.settlement.chance;
    if (present) {
      const capped = cappedSizeTable(
        tables.get("settlement-size"),
        profile.settlement.maxSize,
      );
      // Soft-suppress large sizes near existing big settlements (reweights only;
      // rollTable still draws once, so the rng stream / downstream POI rolls are
      // unchanged whether or not any large neighbour is present).
      const sizeTable = capped && suppressLargeSizes(capped, opts.nearbyLargeCount ?? 0);
      if (sizeTable) {
        settlement = { present: true, size: rollTable(sizeTable, rng).value.size };
      }
    }
  }

  // 3. POIs: auto-generation places at most ONE POI (typed), seeded by its own
  //    deterministic sub-stream. Users can add more by hand (see app.js); the
  //    field stays an array.
  const pois = [];
  if (rng() < profile.poi.chance) {
    const base = opts.coords
      ? ["hex", opts.coords.q, opts.coords.r, opts.gen ?? 0]
      : ["hex", opts.key ?? "?", opts.gen ?? 0];
    const poiRng = subRng(opts.seed ?? 0, ...base, "poi", 0);
    pois.push(generatePoi(tables, poiRng, { terrain, index: 0 }));
  }

  return {
    key: opts.key ?? null,
    coords: opts.coords ?? null,
    placed: opts.placed ?? false,
    terrain, // neighbour-affinity roll (js/gen/affinity.js) — no elevation model
    terrainFeature,
    settlement,
    pois, // typed POI[] (Phase 3); empty array when none
    explored: true,
    createdAt: new Date().toISOString(),
  };
}
