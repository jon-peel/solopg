// Core domain model.
//
// `hexes` is the keyed collection generators populate. Phase 1 stores generated
// hexes under throwaway "unplaced" keys ("u:<n>") with coords:null; Phase 2 will
// introduce axial coordinate keys ("q,r") and place these on a map.

import { axialKey } from "../core/hexgeo.js";

// v2: hexes gained structured contents (Phase 1). v1 worlds had empty hexes only.
// Phase 2 (the map) reused v2 (hexes already carried coords/placed).
// v3: POIs became a typed array (Phase 3) — `hex.pois` is now `POI[]`, not
// `{present,count}`. See migrateWorld in portability.js.
// v4: dungeon POIs gained a generated interior (Phase 4) at `detail.dungeon`,
// replacing the Phase-3 `detail.stub` placeholder.
// v5: the explorable POI types (ruin/cave/mine) were merged into `dungeon` as
// themes (Phase 4 arc) — such POIs become `type:"dungeon"` with `detail.theme`.
// v6: worlds gained a top-level `hooks` array (Phase 6) — adventure hooks that
// point at a hex/POI. Older worlds backfill `hooks: []`. See migrateWorld.
// v7: hexes gained optional GM annotations — `name` (a custom map label) and
// `note` (freeform text). Additive; older hexes simply have none.
// v8: hexes gained first-class `elevation`/`moisture` fields (Phase 3R.3,
// terrain generation v2) — a coordinate-hashed noise sample in [0,1) used by
// the biome classifier (js/gen/biome.js) in place of the retired neighbour-
// affinity terrain roll. Additive; older hexes simply have neither field
// until regenerated.
// v9: hexes gained a `basin` field, and generated Water hexes now come out as
// `terrain:"Lake"` or `terrain:"Sea"` instead of `terrain:"Water"` (Phase
// 3R.4) — Lake/Sea share Water's profile/bias tables via biasKey() in
// terrain-profile.js, so old `Water` hexes keep rendering/behaving fine as-is
// (no retrofit) until regenerated.
// v10: `basin` renamed to `continent` and reworked into a real land/ocean gate
// (3R.4 revision — fixing "inland seas"): Sea now forms genuinely large,
// contiguous coastal bodies correlated with a continent-scale field, instead
// of an independent per-hex label. Old hexes' `basin` field is simply unused
// going forward (no retrofit); `Lake`/`Sea` terrain values are unchanged.
// v11: hexes gained a `riverEdges` array (Phase 3R.5) — NEIGHBOR_DIRS indices
// (0-5) marking which hex-sides carry a river segment, propagated forward
// from mountain sources as neighbouring hexes are generated (js/gen/river.js).
// Additive; older hexes simply have none until regenerated.
// v12: rivers became a top-level `rivers` array (Phase 3R.5 "curated rivers"
// rework) — a watercourse traced from a source to the sea, rendered as a
// polyline. Superseded by v13's terrain rework (elevation removed).
// v13: terrain generation switched from the elevation/moisture/continent noise
// classifier (3R.3/3R.4, deleted) to a neighbour-affinity dice roll
// (js/gen/affinity.js) — the world is now a hex oracle, each tile "anything
// until revealed", order-dependent by design. Hexes no longer carry
// `elevation`/`moisture`/`continent` (old hexes keep them, unused). Old worlds
// load as-is (their terrain strings still render); only regenerated hexes use
// the new roll. Rivers (3R.6) are a DERIVED overlay recomputed from the revealed
// terrain (js/gen/rivers.js — major-water drainage, no elevation) into
// `world.rivers[]`; no schema change (same `{id, source, path, ...}` shape).
// v14: the Thorp size tier was dropped (near-identical to Hamlet); a settlement
// can now carry a martial `kind: "keep"` (fortified site, any size). Migration
// remaps old Thorp settlements to Hamlet; `kind` is additive (absent = normal).
// v15: a top-level `roads` array (Phase 3R.7) — a DERIVED overlay like `rivers`,
// recomputed from terrain + settlements (js/gen/roads.js — gravity trunk network)
// into `world.roads[]`. Migration backfills `roads: []`; syncRoads repopulates it.
// v16: Phase 8.1 — a single `party` marker ({q,r}, default the origin) and a
// reserved `factions` array (populated from 8.7 on). NOTE: the world clock
// ("day") is deliberately NOT part of this — it's an in-memory session
// counter (js/ui/app.js), always starts at 0, never persisted.
export const SCHEMA_VERSION = 16;

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
    // Adventure hooks (Phase 6) — seeds pointing at a hex/POI. A flat top-level
    // list because a hook spans tiles (origin ≠ target), so it isn't owned by one hex.
    hooks: [],
    // Rivers (Phase 3R.5) — full watercourses traced from a source to the sea
    // (js/gen/river-trace.js). A flat top-level list because a river spans
    // dozens of tiles, isn't owned by one hex, and is drawn even across
    // unexplored hexes. Populated incrementally as source hexes are discovered.
    rivers: [],
    // Roads (Phase 3R.7) — a derived gravity trunk network linking settlements
    // (js/gen/roads.js). Like rivers, a flat top-level list (a road spans many
    // tiles, isn't owned by one hex), recomputed by syncRoads as the world grows;
    // append-only so a built road never re-routes.
    roads: [],
    // Party marker (Phase 8.1) — single position; multi-party is out of scope
    // (single-GM-screen decision). The origin is a safe default: hex (0,0)
    // always spawns land under the affinity terrain roll.
    party: { q: 0, r: 0 },
    // Factions (Phase 8.1, reserved) — populated starting 8.7; empty until then.
    factions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Next key for an unplaced (no-coordinates) hex: "u:<n>", monotonic so deleting
 * a hex never reuses its key. The "u:" namespace is intentionally disjoint from
 * Phase 2's axial "q,r" keys.
 * @param {object} world
 * @returns {string}
 */
export function nextUnplacedKey(world) {
  let max = -1;
  for (const key of Object.keys(world.hexes)) {
    const m = /^u:(\d+)$/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `u:${max + 1}`;
}

/**
 * Store a hex in the world under its own key. Mutates and returns the world.
 * @param {object} world
 * @param {object} hex must have a string `key`
 * @returns {object} world
 */
export function addHex(world, hex) {
  world.hexes[hex.key] = hex;
  return world;
}

/**
 * Hex at axial (q,r), or undefined. (Returns any hex stored under that key,
 * placed or not.)
 */
export function getHex(world, q, r) {
  return world.hexes[axialKey(q, r)];
}

/** True if a placed hex occupies axial (q,r). */
export function hasHexAt(world, q, r) {
  const h = world.hexes[axialKey(q, r)];
  return !!(h && h.placed);
}

/** All hexes placed on the map (those with coords and placed === true). */
export function placedHexes(world) {
  return Object.values(world.hexes).filter((h) => h.placed && h.coords);
}

/** Remove the hex at axial (q,r), if any. Mutates and returns the world. */
export function removeHex(world, q, r) {
  delete world.hexes[axialKey(q, r)];
  return world;
}

/** Move the party marker to axial (q,r). Mutates and returns the world. */
export function setPartyPosition(world, q, r) {
  // Preserve the rest of the party state (encumbrance, …) — only the position moves.
  world.party = { ...world.party, q, r };
  return world;
}

/**
 * Set the party's encumbrance tier (Phase 8.4) — one of `ENCUMBRANCE_FACTOR`'s
 * keys (js/gen/travel.js). Additive/self-defaulting, no schema bump: absent
 * means "unencumbered". Mutates and returns the world.
 */
export function setPartyEncumbrance(world, encumbrance) {
  world.party.encumbrance = encumbrance;
  return world;
}

// --- Factions (Phase 8.7, Arc B) -----------------------------------------
// world.factions[] was reserved by the v16 bump (8.1); these populate it. Hooks
// mutate world.hooks directly, but factions get accessors — the plan lists them
// and 8.8 (promote) / 8.9 (claim holding) / 8.10 (turns) want the seam.

/** Append a faction to the world's roster. Mutates and returns the world. */
export function addFaction(world, faction) {
  if (!Array.isArray(world.factions)) world.factions = [];
  world.factions.push(faction);
  return world;
}

/** All factions on the world (never null). */
export function getFactions(world) {
  return world.factions || [];
}

/** Remove a faction by id. Mutates and returns the world. */
export function removeFaction(world, id) {
  if (Array.isArray(world.factions)) {
    world.factions = world.factions.filter((f) => f.id !== id);
  }
  return world;
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
